import SwiftUI

struct Readiness: Decodable {
    struct Check: Decodable, Identifiable { let id: String; let title: String; let ready: Bool; let message: String }
    let checks: [Check]
    let note: String
}

/// Autonomy dial, webhooks, design loop, and where the local service keeps its state.
struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @State private var settings = Settings(autonomy: "review_all", webhook_url: "", webhook_secret: "", design_loop: "on", design_loop_rounds: "3", cap_per_account_per_day: "", timezone: "", auto_plan: "off", stale_after_hours: "6")
    @State private var saved = false
    @State private var readiness: Readiness?
    @State private var credentials: [Credential] = []
    @State private var entry: [String: String] = [:]
    @State private var setups: [String: PlatformSetup] = [:]
    private let levels = [("review_all", "Review everything", "Every post waits for your approval."),
                          ("auto_trusted", "Auto for trusted", "Ready posts on trusted accounts schedule themselves; the rest wait."),
                          ("hands_off", "Hands off", "Every ready post schedules itself. You get webhooks, not questions.")]
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            if let readiness {
                section("Ready to create and publish") {
                    ForEach(readiness.checks) { check in
                        HStack(alignment: .top) {
                            Image(systemName: check.ready ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundStyle(check.ready ? .green : .orange)
                            VStack(alignment: .leading, spacing: 3) { Text(check.title).font(.headline); Text(check.message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                        }
                    }
                    Text(readiness.note).font(.caption).foregroundStyle(.secondary)
                }
            }
            section("Autonomy") {
                ForEach(levels, id: \.0) { level in
                    Button { settings.autonomy = level.0 } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: settings.autonomy == level.0 ? "largecircle.fill.circle" : "circle").foregroundStyle(settings.autonomy == level.0 ? Color.accentColor : .secondary)
                            VStack(alignment: .leading, spacing: 2) { Text(level.1).font(.headline); Text(level.2).font(.callout).foregroundStyle(.secondary) }
                            Spacer()
                        }.padding(12).background(settings.autonomy == level.0 ? Color.accentColor.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain)
                }
                HStack { Text("Max posts per account per day"); TextField("no cap", text: $settings.cap_per_account_per_day).frame(width: 80) }
                HStack { Text("Hold a post if it is this many hours overdue"); TextField("6", text: $settings.stale_after_hours).frame(width: 60) }
                Text("If this Mac is asleep or off when a post is due, it publishes on wake. Anything older than this window is held for review instead of going out late. 0 publishes it however late it is.").font(.caption).foregroundStyle(.secondary)
            }
            section("Design loop") {
                Toggle("Run the critic gauntlet when a new brand is extracted", isOn: Binding(get: { settings.design_loop != "off" }, set: { settings.design_loop = $0 ? "on" : "off" }))
                HStack { Text("Rounds"); Stepper(value: Binding(get: { Int(settings.design_loop_rounds) ?? 3 }, set: { settings.design_loop_rounds = String($0) }), in: 1...6) { Text(settings.design_loop_rounds.isEmpty ? "3" : settings.design_loop_rounds) } }
                Text("Three fresh critics (brief · system · craft) judge the rendered hero until it passes the bar torn down from the client’s own site.").font(.caption).foregroundStyle(.secondary)
            }
            section("Monthly cadence") {
                Toggle("Plan the next month automatically, reusing the last month's brief and settings", isOn: Binding(get: { settings.auto_plan == "on" }, set: { settings.auto_plan = $0 ? "on" : "off" }))
                Text("Drafts still land in the approval inbox; autonomy decides what happens after that.").font(.caption).foregroundStyle(.secondary)
            }
            section("Webhooks") {
                TextField("https://… (called on publish, failure, approval needed)", text: $settings.webhook_url)
                SecureField("Signing secret (optional, sent as x-cadence-signature; leave empty to keep the saved one)", text: $settings.webhook_secret)
            }
            section("Local service") {
                LabeledContent("Endpoint", value: store.base.absoluteString)
                LabeledContent("Data", value: store.appDirectory.path)
                LabeledContent("MCP", value: "node server/src/mcp.js — tools for Claude Code / Codex")
            }
            credentialSection
            HStack {
                if saved { Label("Saved", systemImage: "checkmark").foregroundStyle(.green) }
                Spacer()
                Button("Save settings") { save() }.buttonStyle(.borderedProminent)
            }
        }.textFieldStyle(.roundedBorder)
        .task { if let s: Settings = try? await store.request("/api/settings") { settings = s }; readiness = try? await store.request("/api/readiness"); credentials = (try? await store.request("/api/credentials")) ?? []
            let rows: [PlatformSetup] = (try? await store.request("/api/platforms/setup")) ?? []
            setups = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) }) }
    }
    /// Keys for the services Cadence talks to. Saved values are never sent back, so a filled field
    /// shows as "Saved" rather than as dots that could be copied out.
    private var credentialSection: some View {
        section("Keys and credentials") {
            Text("Stored encrypted in the app's own .env file, readable only by your account. A saved key applies right away.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(Array(Set(credentials.map(\.group))).sorted(), id: \.self) { group in
                DisclosureGroup(group) {
                    ForEach(credentials.filter { $0.group == group }) { field in
                        VStack(alignment: .leading, spacing: 4) {
                            if let setup = portalSetup(field) {
                                PortalLinks(setup: setup).controlSize(.small).padding(.top, 6)
                                if let w = setup.keys_where, !w.isEmpty { Text("Where the keys are: \(w)").font(.caption) }
                            }
                            HStack {
                                Text(field.title).font(.subheadline.weight(.medium))
                                if field.set { Label("Saved", systemImage: "checkmark.seal.fill").font(.caption).foregroundStyle(.green) }
                                Spacer()
                                if field.set { Button("Clear") { store_save(field.key, "") }.controlSize(.small) }
                            }
                            Text(field.hint).font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Group {
                                    if field.secret { SecureField(field.set ? "Replace" : "Paste the value", text: binding(field.key)) }
                                    else { TextField(field.set ? "Replace" : "Paste the value", text: binding(field.key)) }
                                }.onSubmit { store_save(field.key, entry[field.key] ?? "") }
                                Button("Save") { store_save(field.key, entry[field.key] ?? "") }
                                    .disabled((entry[field.key] ?? "").isEmpty).controlSize(.small)
                            }
                        }.padding(.vertical, 4)
                    }
                }
            }
        }
    }
    /// Social sign-in keys come in ID + secret pairs; the developer-page links sit above the ID.
    private func portalSetup(_ field: Credential) -> PlatformSetup? {
        guard field.key.hasPrefix("CADENCE_"), field.key.hasSuffix("_CLIENT_ID") else { return nil }
        return setups[field.key.dropFirst(8).dropLast(10).lowercased()]
    }
    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { entry[key] ?? "" }, set: { entry[key] = $0 })
    }
    private func store_save(_ key: String, _ value: String) {
        Task {
            await store.act {
                let result: CredentialUpdate = try await store.request("/api/credentials", method: "PUT", body: ["key": key, "value": value])
                credentials = result.credentials
            }
            entry[key] = ""
        }
    }
    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { Text(title).font(.title3.weight(.semibold)); content() }
            .padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.background, in: RoundedRectangle(cornerRadius: 14))
    }
    private func save() {
        Task {
            await store.act {
                let body: [String: Any] = ["autonomy": settings.autonomy, "webhook_url": settings.webhook_url, "webhook_secret": settings.webhook_secret, "design_loop": settings.design_loop, "design_loop_rounds": settings.design_loop_rounds, "cap_per_account_per_day": settings.cap_per_account_per_day, "timezone": settings.timezone, "auto_plan": settings.auto_plan, "stale_after_hours": settings.stale_after_hours]
                let _: MutationResult = try await store.request("/api/settings", method: "PUT", body: body)
                settings = try await store.request("/api/settings"); saved = true
            }
        }
    }
}

struct ActivityView: View {
    @EnvironmentObject private var store: Store
    @State private var events: [Event] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Agent log").font(.title3.weight(.semibold))
            if events.isEmpty { Text("Quiet so far.").foregroundStyle(.secondary) }
            ForEach(events) { e in
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(e.level == "error" ? Color.orange : e.level == "warn" ? Color.yellow : Color.secondary.opacity(0.4)).frame(width: 8, height: 8).padding(.top, 6)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.message)
                        Text("\(e.kind) · \(e.ts)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }.task { events = (try? await store.request("/api/events?limit=100")) ?? [] }
    }
}
