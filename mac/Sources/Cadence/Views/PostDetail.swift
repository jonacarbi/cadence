import SwiftUI

/// Approval inbox item: visual preview, per-platform copy, lint, comments, approve / reject / regenerate / reschedule.
struct PostDetail: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let post: Post
    @State private var editing = false
    @State private var acting = false
    @State private var feedback = ""
    @State private var comments: [Comment] = []
    @State private var preview: NSImage?
    @State private var rescheduling = false
    @State private var newDate = Date()
    @State private var picking = false
    /// Connected, unpaused platforms for this brand that the post does not already target.
    private var repurposeTargets: [String] {
        Array(Set(store.accounts.filter { $0.brand_id == current.brand_id && $0.paused == 0 }.map(\.platform)).subtracting(current.platforms)).sorted()
    }
    private var current: Post { store.posts.first { $0.id == post.id } ?? post }
    private var canReview: Bool { ["draft", "rejected"].contains(current.status) }
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            visual.frame(width: 360).background(Color(nsColor: .underPageBackgroundColor))
            VStack(alignment: .leading, spacing: 18) {
                header
                ScrollView { VStack(alignment: .leading, spacing: 16) { copyBlocks; lintBlock; commentBlock } }
                actions
            }.padding(24)
        }.frame(width: 1040, height: 720)
        .task(id: current.image_path) { await loadPreview(); await loadComments() }
        .sheet(isPresented: $editing) { ComposerView(post: current).environmentObject(store) }
        .sheet(isPresented: $picking) { MediaLibrary(post: current).environmentObject(store) }
    }
    private var visual: some View {
        VStack(spacing: 14) {
            if let preview {
                Image(nsImage: preview).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 10)).shadow(radius: 12, y: 6)
            } else if current.format == "text" {
                ContentUnavailableView("Text-only post", systemImage: "text.alignleft")
            } else {
                ProgressView("Rendering visual…").frame(maxHeight: .infinity)
            }
            if let a = current.assets {
                VStack(alignment: .leading, spacing: 4) {
                    if let e = a.eyebrow, !e.isEmpty { Text(e.uppercased()).font(.caption2.weight(.semibold)).tracking(1.2).foregroundStyle(.secondary) }
                    if let h = a.headline { Text(h).font(.headline) }
                    if let f = a.frames, f.count > 1 { Text("Carousel · \(f.count) slides").font(.caption).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Button("New visual", systemImage: "arrow.triangle.2.circlepath") { perform { await store.act { let _: CampaignCreated = try await store.request("/api/posts/\(current.id)/rerender", method: "POST", body: ["fresh_image": true]) } } }
                Button("Re-compose", systemImage: "rectangle.3.group") { perform { await store.act { let _: CampaignCreated = try await store.request("/api/posts/\(current.id)/rerender", method: "POST", body: ["fresh_image": false]) } } }
                Button("Use my image", systemImage: "photo") { picking = true }
                // Same message, same artwork, rewritten for a channel this post does not use yet.
                if !repurposeTargets.isEmpty {
                    Menu("Repurpose") {
                        ForEach(repurposeTargets, id: \.self) { platform in
                            Button(platform.capitalized) { perform { await store.act { let _: Post = try await store.request("/api/posts/\(current.id)/repurpose", method: "POST", body: ["platforms": [platform]]) } } }
                        }
                    }.fixedSize()
                }
            }.controlSize(.small).disabled(acting || current.format == "text" || !["draft","rejected","approved","scheduled"].contains(current.status))
        }.padding(20)
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Text(current.title).font(.title2.weight(.semibold)).lineLimit(2); Spacer(); StatusBadge(status: current.status) }
            HStack(spacing: 14) {
                if let date = current.date { Label(date.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar") }
                if let p = current.pillar, !p.isEmpty { Label(p, systemImage: "tag") }
                Label("Drafted by \(current.drafted_by ?? "agent")", systemImage: "sparkles")
                if let by = current.approved_by { Label("Approved by \(by)", systemImage: "checkmark.seal") }
            }.font(.caption).foregroundStyle(.secondary)
            if let error = current.error { Text(error).foregroundStyle(.orange) }
        }
    }
    private var copyBlocks: some View {
        ForEach(current.platforms, id: \.self) { platform in
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text(platform.capitalized).font(.headline); Spacer(); Text("\(current.copy[platform]?.count ?? 0) chars").font(.caption).foregroundStyle(.secondary) }
                Text(current.copy[platform] ?? "").textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(16).background(.background, in: RoundedRectangle(cornerRadius: 12))
        }
    }
    @ViewBuilder private var lintBlock: some View {
        if let issues = current.lint, !issues.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(issues, id: \.self) { i in Label(i.message, systemImage: i.severity == "block" ? "xmark.octagon" : "exclamationmark.triangle").foregroundStyle(i.severity == "block" ? Color.red : Color.orange).font(.callout) }
            }
        }
    }
    private var commentBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Feedback").font(.headline)
            ForEach(comments) { c in
                VStack(alignment: .leading, spacing: 2) { Text(c.author).font(.caption.weight(.semibold)).foregroundStyle(.secondary); Text(c.body) }
            }
            TextField("Tell the agent what to change…", text: $feedback, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                Button("Add note") { perform { await store.act { let _: Comment = try await store.request("/api/posts/\(current.id)/comments", method: "POST", body: ["body": feedback]) }; feedback = ""; await loadComments() } }.disabled(feedback.isEmpty)
                Button("Regenerate from feedback", systemImage: "wand.and.stars") { perform { await store.act { let _: Post = try await store.request("/api/posts/\(current.id)/regenerate", method: "POST", body: ["feedback": feedback]) }; feedback = ""; await loadComments() } }.disabled(!canReview)
            }.controlSize(.small)
        }
    }
    private var actions: some View {
        HStack {
            Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            if ["draft", "approved", "scheduled", "rejected"].contains(current.status) {
                Button("Edit") { editing = true }
                Button("Reschedule") { newDate = current.date ?? Date(); rescheduling = true }
                    .popover(isPresented: $rescheduling) {
                        VStack(spacing: 12) {
                            DatePicker("Publish at", selection: $newDate, in: Date()...).datePickerStyle(.graphical)
                            Button("Move") { rescheduling = false; perform { await store.act { let _: Post = try await store.request("/api/posts/\(current.id)", method: "PATCH", body: ["version": current.version, "scheduled_at": ISO8601DateFormatter.cadence.string(from: newDate)]) } } }.buttonStyle(.borderedProminent)
                        }.padding()
                    }
            }
            Spacer()
            if ["draft", "approved", "scheduled"].contains(current.status) { Button("Reject") { perform { await store.review(current, action: "reject") } } }
            if canReview {
                Button("Approve & schedule") { perform { await store.review(current, action: "approve-and-schedule") } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            } else if current.status == "approved" {
                Button("Schedule") { perform { await store.schedule(current) } }.buttonStyle(.borderedProminent)
            } else if current.status == "scheduled" {
                Button("Publish now") { perform { await store.act { let _: Post = try await store.request("/api/posts/\(current.id)/publish-now", method: "POST", body: [:]) } } }
            }
        }.disabled(acting)
    }
    private func loadPreview() async {
        guard let path = current.image_path else { preview = nil; return }
        preview = (try? await store.data(store.assetURL(path))).flatMap(NSImage.init(data:))
    }
    private func loadComments() async { comments = (try? await store.request("/api/posts/\(current.id)/comments")) ?? [] }
    private func perform(_ action: @escaping @MainActor () async -> Void) { acting = true; Task { await action(); acting = false } }
}
