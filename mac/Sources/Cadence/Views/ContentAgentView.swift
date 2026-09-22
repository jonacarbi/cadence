import SwiftUI

struct ContentRequest: Decodable, Identifiable {
    struct Input: Decodable { let prompt: String; let website: String; let mode: String }
    let id: String
    let brand_id: String?
    let status: String
    let message: String
    let input: Input
    let job: AgentJob?
    let posts: [Post]
}

struct ContentAgentView: View {
    @EnvironmentObject private var store: Store
    @State private var prompt = ""
    @State private var website = ""
    @State private var mode = "auto"
    @State private var newBrand = false
    @State private var month = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var date = Date().addingTimeInterval(86400)
    @State private var hour = 10
    @State private var requests: [ContentRequest] = []
    @State private var submitting = false
    @State private var requestID = UUID().uuidString
    @State private var activeRequest: String?
    @State private var selectedPost: Post?
    @State private var connectionError: String?
    private var monthly: Bool { mode == "month" || (mode == "auto" && prompt.range(of: #"\b(month|monthly)\b"#, options: [.regularExpression, .caseInsensitive]) != nil) }
    private var channels: [String] { Array(Set(store.accounts.filter { $0.brand_id == store.selectedBrand && $0.paused == 0 }.map(\.platform))).sorted() }
    private var visibleRequests: [ContentRequest] { requests.filter { $0.brand_id == store.selectedBrand || $0.brand_id == nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 16) {
                Text("One idea. Every channel.").font(.title2.weight(.semibold))
                Text("Start with a website or a brief. Create a brand identity, one post adapted to each connected channel, or a full month of daily content.").foregroundStyle(.secondary)
                Toggle("Create a new brand from this request", isOn: $newBrand)
                TextField("Website (optional)", text: $website).textFieldStyle(.roundedBorder)
                TextEditor(text: $prompt).frame(minHeight: 110).padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
                    .accessibilityLabel("Content brief")
                Text("For example: Create a month of content about our coffee subscriptions, with a friendly voice and a focus on new customers.").font(.caption).foregroundStyle(.secondary)
                Picker("Create", selection: $mode) {
                    Text("From my prompt").tag("auto")
                    Text("One post per channel").tag("single")
                    Text("A whole month").tag("month")
                    Text("Brand identity").tag("brand")
                }.pickerStyle(.segmented)
                if mode != "brand" {
                    if monthly {
                        HStack {
                            DatePicker("Month", selection: $month, displayedComponents: .date)
                            Stepper("Publish at \(hour):00", value: $hour, in: 0...23)
                        }
                        Text("One post per day per connected platform. For the current month, only future dates are included. Timezone: \(TimeZone.current.identifier).").font(.caption).foregroundStyle(.secondary)
                    } else {
                        DatePicker("Publishing time", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    }
                    Label(newBrand || store.brands.isEmpty ? "Create the brand first, then connect its social accounts." : channels.isEmpty ? "Connect accounts to this brand to generate content." : "Channels: " + channels.map { $0.capitalized }.joined(separator: ", "), systemImage: "person.2")
                        .font(.callout).foregroundStyle(.secondary)
                    Text("Review the generated content before approving the publishing schedule. Your autonomy setting still applies.").font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                    if submitting { ProgressView().controlSize(.small) }
                    Spacer()
                    Button("Create with Cadence", systemImage: "sparkles") { submit() }
                        .buttonStyle(.borderedProminent)
                        .disabled(submitting || (prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && website.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }.padding(24).background(.background, in: RoundedRectangle(cornerRadius: 14))
            if let connectionError { Label(connectionError, systemImage: "wifi.exclamationmark").foregroundStyle(.orange) }
            ForEach(visibleRequests) { request in
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text(request.input.prompt.isEmpty ? request.input.website : request.input.prompt).font(.headline).lineLimit(3)
                        Spacer()
                        StatusBadge(status: request.job?.status == "interrupted" ? "interrupted" : request.status)
                    }
                    if ["queued", "running"].contains(request.job?.status ?? "") { ProgressView(value: request.job?.progress ?? 0) }
                    Text(request.job?.status == "interrupted" ? request.job?.message ?? request.message : request.message).foregroundStyle(.secondary).textSelection(.enabled)
                    if ["needs_accounts", "failed"].contains(request.status) || ["interrupted", "failed"].contains(request.job?.status ?? "") {
                        Button(request.status == "needs_accounts" ? "Continue with connected accounts" : "Resume request") { action(request, "continue") }.disabled(submitting)
                    }
                    if !request.posts.isEmpty {
                        Text("\(request.posts.count) posts · \(request.posts.reduce(0) { $0 + $1.platforms.count }) channel versions").font(.subheadline)
                        ForEach(request.posts) { post in
                            Button { selectedPost = post } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(post.title).font(.headline)
                                        Text(post.platforms.map { $0.capitalized }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if let date = post.date { Text(date, format: .dateTime.month().day().hour().minute()).font(.caption) }
                                    StatusBadge(status: post.status)
                                }.padding(10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                        if request.status == "review" {
                            Button("Approve and schedule all \(request.posts.count) posts", systemImage: "calendar.badge.checkmark") { action(request, "schedule") }
                                .buttonStyle(.borderedProminent).disabled(submitting)
                        }
                    }
                }.padding(24).background(.background, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                do { try await Task.sleep(for: .seconds(3)) } catch { break }
            }
        }
        .sheet(item: $selectedPost, onDismiss: { Task { await load() } }) { PostDetail(post: $0).environmentObject(store) }
        .onChange(of: mode) { if mode == "brand" { newBrand = true } }
    }
    private func load() async {
        do {
            let next: [ContentRequest] = try await store.request("/api/agent/requests")
            if let activeRequest, let brand = next.first(where: { $0.id == activeRequest })?.brand_id {
                if store.selectedBrand != brand { store.selectedBrand = brand }
                self.activeRequest = nil
            }
            let changed = next.map { "\($0.id):\($0.status):\($0.posts.count)" } != requests.map { "\($0.id):\($0.status):\($0.posts.count)" }
            requests = next; connectionError = nil
            if changed { await store.refresh() }
        } catch { connectionError = error.localizedDescription }
    }
    private func submit() {
        submitting = true
        var body: [String: Any] = ["id": requestID, "prompt": prompt, "website": website, "mode": mode, "time_zone": TimeZone.current.identifier, "hour": hour]
        if !newBrand, let brand = store.selectedBrand { body["brand_id"] = brand }
        if monthly {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM"
            body["month"] = f.string(from: month)
        } else { body["scheduled_at"] = ISO8601DateFormatter.cadence.string(from: date) }
        Task {
            defer { submitting = false }
            do {
                let result: ContentRequest = try await store.request("/api/agent/requests", method: "POST", body: body)
                activeRequest = result.id
                requestID = UUID().uuidString
                if let brand = result.brand_id { store.selectedBrand = brand }
                await load()
            } catch { store.error = error.localizedDescription }
        }
    }
    private func action(_ request: ContentRequest, _ action: String) {
        submitting = true
        Task {
            defer { submitting = false }
            do {
                let result: ContentRequest = try await store.request("/api/agent/requests/\(request.id)/\(action)", method: "POST", body: ["versions": Dictionary(uniqueKeysWithValues: request.posts.map { ($0.id, $0.version) })])
                if let brand = result.brand_id { store.selectedBrand = brand }
                await load(); await store.refresh()
            } catch { store.error = error.localizedDescription; await load() }
        }
    }
}
