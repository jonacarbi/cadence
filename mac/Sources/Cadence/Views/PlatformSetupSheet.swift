import SwiftUI

/// One row of GET /api/platforms/setup: the guide, links and redirect URI for a platform.
struct PlatformSetup: Codable, Identifiable {
    let id: String
    let name: String
    let auth: String
    let ready: Bool
    let developer_portal_url: String?
    let create_app_url: String?
    let keys_where: String?
    let redirect_uri: String?
    let steps: [String]
    let callback_note: String?
}

/// Links straight to the platform's create-app page and the owner's existing apps.
struct PortalLinks: View {
    let setup: PlatformSetup
    var body: some View {
        HStack {
            if let s = setup.create_app_url, let url = URL(string: s) {
                Button { NSWorkspace.shared.open(url) } label: {
                    Label(setup.auth == "oauth" ? "Create your \(setup.name) app" : "Open \(setup.name) setup page", systemImage: "arrow.up.forward.app")
                }.buttonStyle(.borderedProminent)
            }
            if let s = setup.developer_portal_url, s != setup.create_app_url, let url = URL(string: s) {
                Button(setup.auth == "oauth" ? "My apps" : "Settings page") { NSWorkspace.shared.open(url) }
            }
        }
    }
}

/// OAuth connect in three steps: open the developer page, paste the app keys, sign in.
struct PlatformSetupSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var setup: PlatformSetup
    @State private var clientID = ""
    @State private var clientSecret = ""
    @State private var editingKeys = false
    @State private var working = false
    @State private var waiting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Connect \(setup.name)").font(.title2.weight(.semibold))
            section(1, "Create the app") {
                PortalLinks(setup: setup)
                ForEach(setup.steps, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if let uri = setup.redirect_uri, !uri.isEmpty {
                    HStack {
                        Text(uri).font(.system(.callout, design: .monospaced)).textSelection(.enabled).lineLimit(1)
                        Spacer()
                        Button("Copy redirect URI") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(uri, forType: .string) }.controlSize(.small)
                    }.padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
            }
            section(2, "Paste the app keys") {
                if let w = setup.keys_where, !w.isEmpty { Text("Where they are: \(w)").font(.callout) }
                if setup.ready && !editingKeys {
                    HStack { Label("Keys saved", systemImage: "checkmark.seal.fill").foregroundStyle(.green); Button("Replace") { editingKeys = true }.controlSize(.small) }
                } else {
                    TextField("Client ID / App ID", text: $clientID)
                    SecureField("Client secret / App secret", text: $clientSecret)
                    Button(working ? "Saving…" : "Save keys", action: saveKeys).disabled(working || clientID.isEmpty || clientSecret.isEmpty)
                }
            }
            section(3, "Sign in") {
                if let note = setup.callback_note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                Button(waiting ? "Waiting for you to approve in the browser…" : "Sign in with \(setup.name)", action: signIn)
                    .buttonStyle(.borderedProminent).disabled(!setup.ready || waiting || store.selectedBrand == nil)
            }
            HStack { Spacer(); Button("Close") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(28).frame(width: 560).textFieldStyle(.roundedBorder)
    }

    private func section<C: View>(_ n: Int, _ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(n). \(title)").font(.headline)
            content()
        }
    }

    private func saveKeys() {
        working = true
        Task {
            do {
                setup = try await store.request("/api/platforms/\(setup.id)/app", method: "PUT", body: ["client_id": clientID.trimmingCharacters(in: .whitespaces), "client_secret": clientSecret.trimmingCharacters(in: .whitespaces)])
                clientID = ""; clientSecret = ""; editingKeys = false
            } catch { store.error = error.localizedDescription }
            working = false
        }
    }

    private func signIn() {
        guard let brand = store.selectedBrand else { return }
        struct Start: Decodable { let url: String; let state: String }
        struct Status: Decodable { let status: String; let error: String? }
        Task {
            do {
                let r: Start = try await store.request("/oauth/\(setup.id)/start?brand_id=\(brand)")
                guard let url = URL(string: r.url) else { throw APIError(message: "No authorization URL") }
                NSWorkspace.shared.open(url)
                waiting = true
                // Poll this attempt for up to ~5 minutes; the callback lands in the browser, not here.
                for _ in 0..<100 {
                    try await Task.sleep(for: .seconds(3))
                    let s: Status = try await store.request("/oauth/status?state=\(r.state)")
                    if s.status == "done" { await store.refresh(); dismiss(); return }
                    if s.status == "error" { throw APIError(message: s.error ?? "\(setup.name) sign-in failed") }
                }
                throw APIError(message: "Still waiting. If you approved it, refresh the Accounts page.")
            } catch { store.error = error.localizedDescription }
            waiting = false
        }
    }
}
