import SwiftUI
import UniformTypeIdentifiers

struct DesignColor: Codable, Hashable {
    let name: String
    let hex: String
    let role: String
    var color: Color {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
struct DesignSummary: Codable {
    let name: String
    let colors: [DesignColor]
    let documents: [String]
    let image_count: Int
    let font_count: Int
    let file_count: Int
}
struct DesignSource: Codable, Identifiable {
    let id: String
    let name: String
    let source_path: String
    let colors: [DesignColor]
    let image_count: Int
    let font_count: Int
    let file_count: Int
}
struct ClientDesign: Codable, Identifiable {
    let id: String
    let name: String
    let active: Int
    let content_hash: String
    let created_at: String
    let summary: DesignSummary
}
struct DesignSystemsView: View {
    @EnvironmentObject private var store: Store
    @State private var sources: [DesignSource] = []
    @State private var versions: [ClientDesign] = []
    @State private var working = false
    @State private var importingFolder = false
    @State private var filter = ""
    private func brandJob(_ kind: String) {
        guard let id = store.selectedBrand else { return }
        Task { await store.act { let _: CampaignCreated = try await store.request("/api/brands/\(id)/\(kind)", method: "POST", body: [:]) } }
    }
    private var clientName: String { store.brands.first { $0.id == store.selectedBrand }?.name ?? "this client" }
    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            if let active = versions.first(where: { $0.active == 1 }) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack { Label("Active for \(clientName)", systemImage: "checkmark.seal.fill").foregroundStyle(.teal); Spacer(); Text("Saved version \(active.content_hash.prefix(8))").font(.caption).foregroundStyle(.secondary) }
                    Text(active.name).font(.title2.weight(.semibold))
                    palette(active.summary.colors)
                    Text("\(active.summary.font_count) font files · \(active.summary.image_count) images · \(active.summary.file_count) saved files").foregroundStyle(.secondary)
                    Text("New content uses this version. Refreshing imports changes as a new version for you to choose.").font(.callout).foregroundStyle(.secondary)
                    HStack {
                        Button("Check local export for changes") { refreshSource(active) }
                        Button("Re-extract from site", systemImage: "globe") { brandJob("extract") }
                        Button("Run design gauntlet", systemImage: "checkmark.shield") { brandJob("design-loop") }.help("Three fresh critics judge a rendered hero until it passes the bar torn down from the client’s site.")
                    }.disabled(working)
                }.padding(24).background(.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Choose a design system for \(clientName)", systemImage: "paintpalette").font(.title3.weight(.semibold))
                    Text("Reuse the client’s Claude Design colors, typography, imagery, and written guidelines. Assign one below or import an exported folder.").foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(.background, in: RoundedRectangle(cornerRadius: 14))
            }
            HStack {
                Text("Claude Design library").font(.title3.weight(.semibold))
                Spacer()
                Button("Refresh library", systemImage: "arrow.clockwise") { Task { await load() } }
                Button("Import folder…", systemImage: "folder.badge.plus") { importingFolder = true }
            }.disabled(working)
            Text("Available from your local Claude Design exports. Export or sync cloud changes to your Mac before refreshing here.").font(.callout).foregroundStyle(.secondary)
            TextField("Find a client or design system", text: $filter).textFieldStyle(.roundedBorder)
            if sources.isEmpty {
                ContentUnavailableView("No local exports found", systemImage: "folder", description: Text("Export your Claude Design system as a folder, then choose Import folder."))
            }
            ForEach(sources.filter { filter.isEmpty || $0.name.localizedCaseInsensitiveContains(filter) || $0.id.localizedCaseInsensitiveContains(filter) }) { source in
                HStack(alignment: .top, spacing: 22) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(source.name).font(.headline)
                        Text(source.id).font(.caption).foregroundStyle(.secondary)
                        palette(source.colors)
                        Text("\(source.font_count) fonts · \(source.image_count) images · \(source.file_count) files").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Use for \(clientName)") { useSource(["source_id": source.id]) }.buttonStyle(.bordered).disabled(working)
                }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 12))
            }
            if !versions.isEmpty {
                Text("Saved versions").font(.title3.weight(.semibold))
                ForEach(versions) { version in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) { Text(version.name).font(.headline); Text("\(version.created_at) · \(version.content_hash.prefix(8))").font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        if version.active == 1 { StatusBadge(status: "active") } else { Button("Use this version") { activate(version) }.disabled(working) }
                    }.padding(16).background(.background, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .task(id: store.selectedBrand) { await load() }
        .fileImporter(isPresented: $importingFolder, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let url): useSource(["source_path": url.path])
            case .failure(let error): store.error = error.localizedDescription
            }
        }
    }
    private func palette(_ colors: [DesignColor]) -> some View {
        HStack(spacing: 7) {
            ForEach(Array(colors.prefix(12).enumerated()), id: \.offset) { _, color in
                RoundedRectangle(cornerRadius: 6).fill(color.color).frame(width: 30, height: 30).overlay(RoundedRectangle(cornerRadius: 6).stroke(.primary.opacity(0.12))).help("\(color.name): \(color.hex)").accessibilityLabel("\(color.name), \(color.hex)")
            }
            if colors.isEmpty { Text("Guidelines available in the saved design documents").font(.caption).foregroundStyle(.secondary) }
        }
    }
    private func load() async {
        guard let id = store.selectedBrand else { return }
        do {
            sources = try await store.request("/api/design-library")
            versions = try await store.request("/api/brands/\(id)/design-systems")
        } catch { store.error = error.localizedDescription }
    }
    private func useSource(_ body: [String: Any]) {
        guard let id = store.selectedBrand else { return }
        working = true
        Task {
            defer { working = false }
            do {
                let system: ClientDesign = try await store.request("/api/brands/\(id)/design-systems", method: "POST", body: body)
                let _: ClientDesign = try await store.request("/api/brands/\(id)/design-systems/\(system.id)/activate", method: "POST", body: [:])
                await load()
            } catch { store.error = error.localizedDescription }
        }
    }
    private func activate(_ system: ClientDesign) {
        guard let id = store.selectedBrand else { return }
        working = true
        Task {
            defer { working = false }
            do { let _: ClientDesign = try await store.request("/api/brands/\(id)/design-systems/\(system.id)/activate", method: "POST", body: [:]); await load() }
            catch { store.error = error.localizedDescription }
        }
    }
    private func refreshSource(_ system: ClientDesign) {
        guard let id = store.selectedBrand else { return }
        working = true
        Task {
            defer { working = false }
            do { let _: ClientDesign = try await store.request("/api/brands/\(id)/design-systems/\(system.id)/refresh", method: "POST", body: [:]); await load() }
            catch { store.error = error.localizedDescription }
        }
    }
}
