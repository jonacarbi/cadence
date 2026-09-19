import Foundation

struct Brand: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let url: String
    let status: String
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
    var title: String { (topic?.isEmpty == false ? topic : nil) ?? copy.values.sorted().first ?? "Untitled post" }
    var date: Date? { ISO8601DateFormatter.cadence.date(from: scheduled_at) }
}
struct Account: Codable, Identifiable {
    let id: String
    let brand_id: String
    let platform: String
    let label: String
    let paused: Int
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
    private let base = URL(string: "http://127.0.0.1:8796")!
    private var appDirectory: URL {
        if let directory = ProcessInfo.processInfo.environment["CADENCE_DIR"] { return URL(fileURLWithPath: directory) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cadence")
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: base) else { throw APIError(message: "Invalid request") }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
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
    func addBrand(name: String, url: String) async -> Bool {
        do {
            let brand: Brand = try await request("/api/brands", method: "POST", body: ["name": name, "url": url])
            selectedBrand = brand.id; await refresh(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func review(_ post: Post, action: String) async {
        do {
            let _: Post = try await request("/api/posts/\(post.id)/\(action)", method: "POST", body: ["version": post.version])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func saveDraft(post: Post?, topic: String, caption: String, platform: String, date: Date) async -> Bool {
        guard let brand = selectedBrand else { return false }
        var body: [String: Any] = ["brand_id": brand, "topic": topic, "copy": [platform: caption], "platforms": [platform], "scheduled_at": ISO8601DateFormatter.cadence.string(from: date)]
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
