import SwiftUI

struct BrandForm: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var url = ""
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Make room for a new brand").font(.title2.weight(.semibold))
            Text("Keep each client’s posts, identity, and accounts together.").foregroundStyle(.secondary)
            Form {
                TextField("Business name", text: $name)
                TextField("Website", text: $url, prompt: Text("https://example.com"))
            }.formStyle(.grouped)
            HStack { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); Button(saving ? "Adding…" : "Add brand") { saving = true; Task { if await store.addBrand(name: name, url: url) { dismiss() }; saving = false } }.buttonStyle(.borderedProminent).disabled(saving || name.isEmpty || url.isEmpty).keyboardShortcut(.defaultAction) }
        }.padding(28).frame(width: 500)
    }
}
struct ComposerView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let post: Post?
    @State private var topic = ""
    @State private var caption = ""
    @State private var platform = "mastodon"
    @State private var date = Date().addingTimeInterval(86400)
    @State private var saving = false
    private let platforms = ["mastodon", "bluesky", "linkedin", "x", "threads", "facebook", "instagram", "pinterest", "tiktok", "youtube", "telegram", "discord"]
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(post == nil ? "A new idea, ready to grow." : "Refine your draft").font(.title2.weight(.semibold))
            TextField("Topic or working title", text: $topic).textFieldStyle(.roundedBorder)
            HStack {
                Picker("Platform", selection: $platform) { ForEach(platforms, id: \.self) { Text($0.capitalized).tag($0) } }
                DatePicker("Publish", selection: $date)
            }
            Text("Caption").font(.headline)
            TextEditor(text: $caption).font(.body).frame(minHeight: 230).padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
            HStack { Text("\(caption.count) characters").font(.caption).foregroundStyle(.secondary); Spacer(); Text("Saved as a draft for review").font(.caption).foregroundStyle(.secondary) }
            if post != nil { Text("Changes clear the previous approval.").font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(saving ? "Saving…" : "Save draft") {
                    saving = true
                    Task { if await store.saveDraft(post: post, topic: topic, caption: caption, platform: platform, date: date) { dismiss() }; saving = false }
                }.buttonStyle(.borderedProminent).disabled(saving || caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(28).frame(width: 650)
        .onAppear { if let post { topic = post.topic ?? ""; platform = post.platforms.first ?? "mastodon"; caption = post.copy[platform] ?? ""; date = post.date ?? date } }
    }
}
struct PostDetail: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let post: Post
    @State private var editing = false
    @State private var acting = false
    private var current: Post { store.posts.first { $0.id == post.id } ?? post }
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack { Text(current.topic?.isEmpty == false ? current.topic! : "Review post").font(.title2.weight(.semibold)); Spacer(); StatusBadge(status: current.status) }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(current.platforms, id: \.self) { platform in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(platform.capitalized).font(.headline)
                            Text(current.copy[platform] ?? "").textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }.frame(minHeight: 240, maxHeight: 450)
            if let date = current.date { Label(date.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar").foregroundStyle(.secondary) }
            if let error = current.error { Text(error).foregroundStyle(.orange) }
            HStack {
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
                if ["draft", "approved", "scheduled", "rejected"].contains(current.status) {
                    Button("Edit draft") { editing = true }.disabled(current.platforms.count != 1)
                }
                Spacer()
                if ["draft", "approved", "scheduled"].contains(current.status) {
                    Button("Reject") { perform { await store.review(current, action: "reject") } }
                }
                if ["draft", "rejected"].contains(current.status) {
                    Button("Approve post") { perform { await store.review(current, action: "approve") } }.buttonStyle(.borderedProminent)
                } else if current.status == "approved" {
                    Button("Schedule post") { perform { await store.schedule(current) } }.buttonStyle(.borderedProminent)
                }
            }.disabled(acting)
        }.padding(28).frame(width: 700)
        .sheet(isPresented: $editing) { ComposerView(post: current).environmentObject(store) }
    }
    private func perform(_ action: @escaping @MainActor () async -> Void) { acting = true; Task { await action(); acting = false } }
}
