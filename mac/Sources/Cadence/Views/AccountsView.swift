import SwiftUI

/// Destinations for the selected brand: OAuth connect, manual credentials, pause / trust / remove.
struct AccountsView: View {
    @EnvironmentObject private var store: Store
    @State private var capabilities: [Capability] = []
    @State private var connecting: Capability?
    private var accounts: [Account] { store.accounts.filter { $0.brand_id == store.selectedBrand } }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Connected destinations").font(.title3.weight(.semibold))
                if accounts.isEmpty { Text("Nothing connected yet. Approved posts stay in the queue until a destination exists.").foregroundStyle(.secondary) }
                ForEach(accounts) { account in row(account) }
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Add a destination").font(.headline)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(capabilities) { cap in
                        Button { connect(cap) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(cap.name).font(.subheadline.weight(.semibold))
                                Text(cap.auth == "oauth" ? "Sign in" : "Credentials").font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(.background, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain).disabled(!cap.available || store.selectedBrand == nil).opacity(cap.available ? 1 : 0.4)
                    }
                }
            }
        }
        .task { capabilities = (try? await store.request("/api/capabilities")) ?? [] }
        .sheet(item: $connecting) { cap in ManualAccountForm(capability: cap).environmentObject(store) }
    }
    private func row(_ account: Account) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "person.crop.circle").font(.title2).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.label).font(.headline)
                HStack(spacing: 8) {
                    Text(account.platform.capitalized).font(.caption).foregroundStyle(.secondary)
                    if let e = account.last_error { Text(e).font(.caption).foregroundStyle(.orange).lineLimit(1) }
                }
            }
            Spacer()
            Toggle("Trusted", isOn: Binding(get: { account.trusted == 1 }, set: { on in Task { await store.act { let _: Account = try await store.request("/api/accounts/\(account.id)", method: "PATCH", body: ["trusted": on]) } } }))
                .toggleStyle(.switch).controlSize(.small).help("Trusted accounts can auto-publish when autonomy is set to “Auto for trusted”.")
            Button(account.paused == 1 ? "Resume" : "Pause") { Task { await store.act { let _: Account = try await store.request("/api/accounts/\(account.id)/pause", method: "POST", body: ["paused": account.paused == 0]) } } }.controlSize(.small)
            Button(role: .destructive) { Task { await store.act { let _: [String: Bool] = try await store.request("/api/accounts/\(account.id)", method: "DELETE", body: nil) } } } label: { Image(systemName: "trash") }.controlSize(.small)
            StatusBadge(status: account.paused == 1 ? "paused" : "connected")
        }.padding(14).background(.background, in: RoundedRectangle(cornerRadius: 12))
    }
    private func connect(_ cap: Capability) {
        guard let brand = store.selectedBrand else { return }
        if cap.auth == "manual" { connecting = cap; return }
        Task {
            await store.act {
                let r: [String: String] = try await store.request("/oauth/\(cap.id)/start?brand_id=\(brand)")
                guard let s = r["url"], let url = URL(string: s) else { throw APIError(message: "No authorization URL") }
                NSWorkspace.shared.open(url)
            }
        }
    }
}

struct ManualAccountForm: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let capability: Capability
    @State private var values: [String: String] = [:]
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connect \(capability.name)").font(.title2.weight(.semibold))
            Text("Credentials are encrypted on this Mac and verified before the account is saved.").foregroundStyle(.secondary)
            ForEach(capability.fields, id: \.self) { field in
                if field.contains("password") || field.contains("token") || field.contains("secret") {
                    SecureField(field.replacingOccurrences(of: "_", with: " ").capitalized, text: binding(field))
                } else {
                    TextField(field.replacingOccurrences(of: "_", with: " ").capitalized, text: binding(field))
                }
            }
            HStack {
                Spacer(); Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Verifying…" : "Connect") { save() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || capability.fields.contains { (values[$0] ?? "").isEmpty })
            }
        }.padding(28).frame(width: 420).textFieldStyle(.roundedBorder)
    }
    private func binding(_ f: String) -> Binding<String> { Binding(get: { values[f] ?? "" }, set: { values[f] = $0 }) }
    private func save() {
        guard let brand = store.selectedBrand else { return }
        saving = true
        Task {
            do {
                let _: Account = try await store.request("/api/accounts/manual", method: "POST", body: ["brand_id": brand, "platform": capability.id, "fields": values])
                await store.refresh(); dismiss()
            } catch { store.error = error.localizedDescription }
            saving = false
        }
    }
}
