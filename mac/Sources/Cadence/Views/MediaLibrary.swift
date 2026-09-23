import SwiftUI
import AppKit

/// The owner's own artwork. Picking one replaces the post's generated visual, which clears approval
/// the same way an edit does — the image is part of what was approved.
struct MediaItem: Codable, Identifiable, Hashable {
    let id: String
    let path: String
    let filename: String
    let bytes: Int
    let alt_text: String
}
struct OK: Decodable { let ok: Bool }

struct MediaLibrary: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let post: Post
    @State private var items: [MediaItem] = []
    @State private var busy = false
    @State private var error: String?
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14)]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your images").font(.title2.weight(.semibold))
            Text("Images you add here stay with this brand and can be reused on any post.").font(.callout).foregroundStyle(.secondary)
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
            if items.isEmpty {
                VStack(spacing: 8) { Image(systemName: "photo.on.rectangle.angled").font(.largeTitle).foregroundStyle(.tertiary); Text("Nothing here yet.").foregroundStyle(.secondary) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView { LazyVGrid(columns: columns, spacing: 14) { ForEach(items) { item in tile(item) } } }
            }
            HStack {
                Button("Add image…", systemImage: "plus") { add() }
                if post.image_path != nil {
                    Button("Remove from post") { run { let _: Post = try await store.request("/api/posts/\(post.id)/media", method: "DELETE"); await store.refresh(); dismiss() } }
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }.padding(24).frame(width: 640, height: 520).disabled(busy)
        .task { await load() }
    }
    private func tile(_ item: MediaItem) -> some View {
        VStack(spacing: 6) {
            AsyncThumbnail(path: item.path).frame(height: 110).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 8))
            Text(item.filename).font(.caption).lineLimit(1).truncationMode(.middle)
            Button("Use") { attach(item) }.controlSize(.small)
        }.padding(8).background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .underPageBackgroundColor)))
        .contextMenu { Button("Remove from library", role: .destructive) { remove(item) } }
    }
    private func load() async { items = (try? await store.request("/api/media?brand_id=\(post.brand_id)")) ?? [] }
    private func add() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .webP]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        run { let _: MediaItem = try await store.request("/api/media", method: "POST", body: ["brand_id": post.brand_id, "path": url.path]) }
    }
    private func attach(_ item: MediaItem) {
        run {
            let _: Post = try await store.request("/api/posts/\(post.id)/media", method: "POST", body: ["media_id": item.id, "version": post.version])
            await store.refresh()
            dismiss()
        }
    }
    private func remove(_ item: MediaItem) { run { let _: OK = try await store.request("/api/media/\(item.id)", method: "DELETE") } }
    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true; error = nil
        Task { do { try await work() } catch { self.error = error.localizedDescription }; await load(); busy = false }
    }
}

private struct AsyncThumbnail: View {
    @EnvironmentObject private var store: Store
    let path: String
    @State private var image: NSImage?
    var body: some View {
        Group {
            if let image { Image(nsImage: image).resizable().scaledToFill() }
            else { Rectangle().fill(Color(nsColor: .separatorColor)) }
        }.task { image = (try? await store.data(store.assetURL(path))).flatMap(NSImage.init(data:)) }
    }
}
