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
            Text("Paste the client’s website. Cadence extracts the design system, checks design memory, and codifies the look.").foregroundStyle(.secondary)
            Form {
                TextField("Business name (optional — taken from the site)", text: $name)
                TextField("Website", text: $url, prompt: Text("https://example.com"))
            }.formStyle(.grouped)
            HStack { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); Button(saving ? "Adding…" : "Add brand") { saving = true; Task { if await store.addBrand(name: name, url: url) { dismiss() }; saving = false } }.buttonStyle(.borderedProminent).disabled(saving || url.isEmpty).keyboardShortcut(.defaultAction) }
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
