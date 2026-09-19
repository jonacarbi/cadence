import SwiftUI

/// Autonomy dial, webhooks, design loop, and where the local service keeps its state.
struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @State private var settings = Settings(autonomy: "review_all", webhook_url: "", webhook_secret: "", design_loop: "on", design_loop_rounds: "3", cap_per_account_per_day: "", timezone: "")
    @State private var saved = false
    private let levels = [("review_all", "Review everything", "Every post waits for your approval."),
                          ("auto_trusted", "Auto for trusted", "Ready posts on trusted accounts schedule themselves; the rest wait."),
                          ("hands_off", "Hands off", "Every ready post schedules itself. You get webhooks, not questions.")]
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
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
            }
            section("Design loop") {
                Toggle("Run the critic gauntlet when a new brand is extracted", isOn: Binding(get: { settings.design_loop != "off" }, set: { settings.design_loop = $0 ? "on" : "off" }))
                HStack { Text("Rounds"); Stepper(value: Binding(get: { Int(settings.design_loop_rounds) ?? 3 }, set: { settings.design_loop_rounds = String($0) }), in: 1...6) { Text(settings.design_loop_rounds.isEmpty ? "3" : settings.design_loop_rounds) } }
                Text("Three fresh critics (brief · system · craft) judge the rendered hero until it passes the bar torn down from the client’s own site.").font(.caption).foregroundStyle(.secondary)
            }
            section("Webhooks") {
                TextField("https://… (called on publish, failure, approval needed)", text: $settings.webhook_url)
                SecureField("Signing secret (optional, sent as x-cadence-signature)", text: $settings.webhook_secret)
            }
            section("Local service") {
                LabeledContent("Endpoint", value: store.base.absoluteString)
                LabeledContent("Data", value: store.appDirectory.path)
                LabeledContent("MCP", value: "node server/src/mcp.js — tools for Claude Code / Codex")
            }
            HStack {
                if saved { Label("Saved", systemImage: "checkmark").foregroundStyle(.green) }
                Spacer()
                Button("Save settings") { save() }.buttonStyle(.borderedProminent)
            }
        }.textFieldStyle(.roundedBorder)
        .task { if let s: Settings = try? await store.request("/api/settings") { settings = s } }
    }
    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { Text(title).font(.title3.weight(.semibold)); content() }
            .padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.background, in: RoundedRectangle(cornerRadius: 14))
    }
    private func save() {
        Task {
            await store.act {
                let body: [String: Any] = ["autonomy": settings.autonomy, "webhook_url": settings.webhook_url, "webhook_secret": settings.webhook_secret, "design_loop": settings.design_loop, "design_loop_rounds": settings.design_loop_rounds, "cap_per_account_per_day": settings.cap_per_account_per_day]
                let s: Settings = try await store.request("/api/settings", method: "PUT", body: body)
                settings = s; saved = true
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
