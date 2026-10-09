import Foundation
import AppKit

struct Brand: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let url: String
    let status: String
    let skill_slug: String?
    let logo_path: String?
}
struct Post: Codable, Identifiable, Hashable {
    let id: String
    let brand_id: String
    let scheduled_at: String
    let status: String
    let topic: String?
    let copy: [String: String]
    let platforms: [String]
    let version: Int
    let error: String?
    let image_path: String?
    let format: String?
    let approved_by: String?
    let drafted_by: String?
    let pillar: String?
    let assets: PostAssets?
    let lint: [LintIssue]?
    var title: String { (topic?.isEmpty == false ? topic : nil) ?? copy.values.sorted().first ?? "Untitled post" }
    var date: Date? { ISO8601DateFormatter.cadence.date(from: scheduled_at) }
}
struct PostAssets: Codable, Hashable {
    let headline: String?
    let sub: String?
    let eyebrow: String?
    let cta: String?
    let layout: String?
    let hook: String?
    let frames: [String]?
    let square: String?
}
struct LintIssue: Codable, Hashable {
    let severity: String
    let platform: String?
    let message: String
}
struct Comment: Codable, Identifiable {
    let id: String
    let author: String
    let body: String
    let created_at: String
}
struct Capability: Codable, Identifiable {
    let id: String
    let name: String
    let available: Bool
    let auth: String?
    let fields: [String]
}
struct Source: Codable, Identifiable {
    let id: String
    let url: String
    let label: String
    let paused: Int
    let last_error: String?
    let pending: Int
}
struct Credential: Codable, Identifiable {
    var id: String { key }
    let key: String
    let title: String
    let group: String
    let hint: String
    let secret: Bool
    let set: Bool
}
struct CredentialUpdate: Codable {
    let credentials: [Credential]
    let restart_required: Bool
}
struct Settings: Codable {
    var autonomy: String
    var webhook_url: String
    var webhook_secret: String
    var design_loop: String
    var design_loop_rounds: String
    var cap_per_account_per_day: String
    var timezone: String
    var auto_plan: String
    var stale_after_hours: String
}
struct Event: Codable, Identifiable {
    let id: Int
    let ts: String
    let level: String
    let kind: String
    let message: String
}
struct Account: Codable, Identifiable {
    let id: String
    let brand_id: String
    let platform: String
    let label: String
    let paused: Int
    let trusted: Int
    let last_error: String?
}
struct Delivery: Codable, Identifiable {
    let id: String
    let post_id: String
    let account_id: String
    let status: String
    let error: String?
    let remote_url: String?
}
extension ISO8601DateFormatter {
    static var cadence: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct MutationResult: Decodable { let ok: Bool }
@MainActor
final class Store: ObservableObject {
    @Published var brands: [Brand] = []
    @Published var posts: [Post] = []
    @Published var accounts: [Account] = []
    @Published var deliveries: [Delivery] = []
    @Published var selectedBrand: String? = nil
    @Published var error: String? = nil
    @Published var busy = false
    @Published var connected = false
    let base = URL(string: "http://127.0.0.1:8796")!
    var appDirectory: URL {
        if let directory = ProcessInfo.processInfo.environment["CADENCE_DIR"] { return URL(fileURLWithPath: directory) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cadence")
    }
    /// Signs the default browser in: trades the owner token for a single-use 60 s ticket, so only the ticket reaches the URL.
    func openWebDashboard() {
        Task { @MainActor in
            guard let token = try? String(contentsOf: appDirectory.appendingPathComponent("owner.token"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) else { error = "Owner token not found"; return }
            var request = URLRequest(url: base.appendingPathComponent("auth/ticket"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            struct Ticket: Decodable { let ticket: String }
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let ticket = try? JSONDecoder().decode(Ticket.self, from: data),
                  var parts = URLComponents(url: base.appendingPathComponent("auth/login"), resolvingAgainstBaseURL: false) else { error = "Could not sign in to the web dashboard. Is Cadence running?"; return }
            parts.queryItems = [URLQueryItem(name: "c", value: ticket.ticket)]
            if let url = parts.url { NSWorkspace.shared.open(url) }
        }
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: base) else { throw APIError(message: "Invalid request") }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        if path.hasSuffix("/regenerate") { request.timeoutInterval = 660 }
        let token: String
        do { token = try String(contentsOf: appDirectory.appendingPathComponent("owner.token"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
        catch { throw APIError(message: "The Cadence service has not started. Start the local service, then refresh.") }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpMethod = method
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "The local service did not respond") }
        guard (200..<300).contains(http.statusCode) else {
            let details = try? JSONSerialization.jsonObject(with: data) as? [String: String]
            throw APIError(message: details?["error"] ?? "Request failed (\(http.statusCode))")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func startServiceAndRefresh() async {
        do { try await LocalService.shared.startIfNeeded(); await refresh() }
        catch { self.error = error.localizedDescription }
    }
    func refresh() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            let fetched: [Brand] = try await request("/api/brands")
            brands = fetched
            if selectedBrand == nil { selectedBrand = brands.first?.id }
            accounts = try await request("/api/accounts")
            deliveries = try await request("/api/deliveries")
            if let id = selectedBrand { posts = try await request("/api/posts?brand_id=\(id)") } else { posts = [] }
            connected = true
        } catch { connected = false; self.error = error.localizedDescription }
    }
    func data(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: base) else { throw APIError(message: "Invalid request") }
        var request = URLRequest(url: url)
        let token = try String(contentsOf: appDirectory.appendingPathComponent("owner.token"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(message: "Asset unavailable") }
        return data
    }
    func assetURL(_ path: String) -> String { "/api/assets?path=" + (path.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "") }
    /// Wraps a call: surfaces the error in the alert, refreshes on success.
    func act(_ work: @escaping @MainActor () async throws -> Void) async {
        do { try await work(); await refresh() } catch { self.error = error.localizedDescription }
    }
    func addBrand(name: String, url: String) async -> Bool {
        do {
            var body: [String: Any] = ["url": url]
            if !name.trimmingCharacters(in: .whitespaces).isEmpty { body["name"] = name }
            let brand: Brand = try await request("/api/brands", method: "POST", body: body)
            selectedBrand = brand.id; await refresh(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func review(_ post: Post, action: String) async {
        do {
            let _: Post = try await request("/api/posts/\(post.id)/\(action)", method: "POST", body: ["version": post.version])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func saveDraft(post: Post?, topic: String, caption: String, platform: String, date: Date, copies: [String: String]? = nil) async -> Bool {
        guard let brand = selectedBrand else { return false }
        var captions = copies ?? post?.copy ?? [:]; captions[platform] = caption
        var body: [String: Any] = ["brand_id": brand, "topic": topic, "copy": captions, "platforms": post?.platforms ?? [platform], "scheduled_at": ISO8601DateFormatter.cadence.string(from: date)]
        if let post { body["version"] = post.version }
        do {
            let _: Post = try await request(post.map { "/api/posts/\($0.id)" } ?? "/api/posts", method: post == nil ? "POST" : "PATCH", body: body)
            await refresh(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func schedule(_ post: Post) async {
        let matching = accounts.filter { $0.brand_id == post.brand_id && post.platforms.contains($0.platform) && $0.paused == 0 }
        do {
            let _: Post = try await request("/api/posts/\(post.id)/schedule", method: "POST", body: ["version": post.version, "account_ids": matching.map(\.id)])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}
