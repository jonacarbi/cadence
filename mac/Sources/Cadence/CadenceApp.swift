import SwiftUI

@main
struct CadenceApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        WindowGroup {
            WorkspaceView().environmentObject(store).frame(minWidth: 980, minHeight: 680)
        }
        .defaultSize(width: 1240, height: 820)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Refresh Workspace") { Task { await store.refresh() } }.keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}

enum WorkspaceSection: String, CaseIterable, Identifiable {
    case overview = "Overview", designs = "Design systems", planner = "Monthly planner", calendar = "Calendar", approvals = "Approvals", library = "All posts", accounts = "Accounts", activity = "Delivery activity", log = "Agent log", settings = "Settings"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .designs: "paintpalette"
        case .planner: "sparkles"
        case .calendar: "calendar"
        case .approvals: "checkmark.seal"
        case .library: "square.stack"
        case .accounts: "person.crop.circle.badge.checkmark"
        case .activity: "clock.arrow.circlepath"
        case .log: "list.bullet.rectangle"
        case .settings: "slider.horizontal.3"
        }
    }
}
struct WorkspaceView: View {
    @EnvironmentObject private var store: Store
    @State private var section: WorkspaceSection? = .overview
    @State private var addingBrand = false
    @State private var composing = false
    @State private var selectedPost: Post?
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 10) {
                    Image(systemName: "waveform.path").font(.title).foregroundStyle(.teal)
                    Text("Cadence").font(.title2.weight(.semibold))
                }.padding(.horizontal, 16).padding(.top, 20)
                Picker("Brand", selection: $store.selectedBrand) {
                    Text("Choose a brand").tag(String?.none)
                    ForEach(store.brands) { brand in Text(brand.name).tag(Optional(brand.id)) }
                }.labelsHidden().padding(.horizontal, 12)
                List(selection: $section) {
                    ForEach(WorkspaceSection.allCases) { item in Label(item.rawValue, systemImage: item.icon).tag(item) }
                }.listStyle(.sidebar)
                VStack(alignment: .leading, spacing: 10) {
                    Button("Add a brand", systemImage: "plus") { addingBrand = true }
                    Label(store.connected ? "Local service connected" : "Service disconnected", systemImage: store.connected ? "circle.fill" : "exclamationmark.circle")
                        .font(.caption).foregroundStyle(store.connected ? Color.secondary : Color.orange)
                    Text("Posts publish while your Mac is running.").font(.caption).foregroundStyle(.secondary)
                }.padding(16)
            }.navigationSplitViewColumnWidth(min: 210, ideal: 230)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    if store.brands.isEmpty {
                        ContentUnavailableView {
                            Label("Your next month starts here", systemImage: "calendar.badge.plus")
                        } description: { Text("Add a client’s business to organize its posts and approvals.") }
                        actions: { Button("Add your first brand") { addingBrand = true }.buttonStyle(.borderedProminent) }
                    } else {
                        switch section ?? .overview {
                        case .overview: overview
                        case .designs: DesignSystemsView()
                        case .planner: PlannerView()
                        case .calendar: CalendarView(posts: store.posts, select: { selectedPost = $0 })
                        case .approvals: postList(store.posts.filter { ["draft", "rejected"].contains($0.status) })
                        case .library: postList(store.posts)
                        case .accounts: AccountsView()
                        case .activity: deliveryList
                        case .log: ActivityView()
                        case .settings: SettingsView()
                        }
                    }
                }.padding(32).frame(maxWidth: 1300, alignment: .leading).frame(maxWidth: .infinity)
            }.background(Color(nsColor: .windowBackgroundColor))
            .navigationTitle(section?.rawValue ?? "Overview")
            .toolbar {
                ToolbarItem { Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("Refresh workspace").disabled(store.busy) }
                ToolbarItem { Button("New post", systemImage: "square.and.pencil") { composing = true }.disabled(store.selectedBrand == nil) }
            }
        }
        .task { await store.startServiceAndRefresh() }
        .onChange(of: store.selectedBrand) { Task { await store.refresh() } }
        .sheet(isPresented: $addingBrand) { BrandForm().environmentObject(store) }
        .sheet(isPresented: $composing) { ComposerView(post: nil).environmentObject(store) }
        .sheet(item: $selectedPost) { post in PostDetail(post: post).environmentObject(store) }
        .alert("Cadence needs your attention", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.brands.first { $0.id == store.selectedBrand }?.name.uppercased() ?? "YOUR WORKSPACE").font(.caption.weight(.semibold)).tracking(1.8).foregroundStyle(.secondary)
            Text(section == .overview ? "A little planning. A steady presence." : section?.rawValue ?? "Overview").font(.system(size: 30, weight: .semibold))
            Text(section == .approvals ? "Review every draft before it reaches your audience." : "Create with intention. Review with confidence.").foregroundStyle(.secondary)
        }
    }
    private var overview: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack(spacing: 16) {
                metric("Awaiting review", count: store.posts.filter { $0.status == "draft" }.count, icon: "tray")
                metric("Scheduled", count: store.posts.filter { $0.status == "scheduled" }.count, icon: "calendar")
                metric("Published", count: store.posts.filter { $0.status == "published" }.count, icon: "checkmark.circle")
            }
            HStack { Text("Your upcoming posts").font(.title3.weight(.semibold)); Spacer(); Button("View calendar") { section = .calendar } }
            postList(Array(store.posts.filter { $0.status != "published" }.prefix(8)))
        }
    }
    private func metric(_ name: String, count: Int, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(name, systemImage: icon).foregroundStyle(.secondary)
            Text(count.formatted()).font(.system(size: 38, weight: .medium, design: .rounded))
        }.frame(maxWidth: .infinity, alignment: .leading).padding(22).background(.background, in: RoundedRectangle(cornerRadius: 14))
    }
    private func postList(_ posts: [Post]) -> some View {
        VStack(spacing: 0) {
            if posts.isEmpty { ContentUnavailableView("A clear calendar", systemImage: "text.badge.plus", description: Text("Create a draft to start building your next month.")) }
            ForEach(posts) { post in
                Button { selectedPost = post } label: {
                    HStack(spacing: 18) {
                        Image(systemName: "text.alignleft").foregroundStyle(.teal).frame(width: 48, height: 54).background(.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(post.title).font(.headline).lineLimit(1)
                            Text(post.platforms.map { $0.capitalized }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let date = post.date { Text(date, format: .dateTime.month(.abbreviated).day().hour().minute()).font(.caption).foregroundStyle(.secondary) }
                        StatusBadge(status: post.status)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }.padding(16).contentShape(Rectangle())
                }.buttonStyle(.plain)
                if post.id != posts.last?.id { Divider().padding(.leading, 82) }
            }
        }.background(.background, in: RoundedRectangle(cornerRadius: 14))
    }
    private var deliveryList: some View {
        VStack(alignment: .leading, spacing: 16) {
            if store.deliveries.isEmpty { ContentUnavailableView("No deliveries yet", systemImage: "paperplane", description: Text("Delivery receipts and any publishing issues will appear here.")) }
            ForEach(store.deliveries.filter { delivery in store.posts.contains { $0.id == delivery.post_id } }) { delivery in
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text(store.posts.first { $0.id == delivery.post_id }?.title ?? "Post").font(.headline); Spacer(); StatusBadge(status: delivery.status) }
                    if let error = delivery.error { Text(error).font(.callout).foregroundStyle(.orange) }
                    if let link = delivery.remote_url, let url = URL(string: link), url.scheme == "https" { Link("View published post", destination: url) }
                }.padding().background(.background, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}
struct StatusBadge: View {
    let status: String
    private var color: Color { switch status { case "published", "approved", "connected": .green; case "scheduled": .blue; case "failed", "uncertain": .orange; default: .secondary } }
    var body: some View { Text(status.capitalized).font(.caption.weight(.medium)).padding(.horizontal, 10).padding(.vertical, 5).foregroundStyle(color).background(color.opacity(0.1), in: Capsule()) }
}
