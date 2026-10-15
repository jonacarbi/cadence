import SwiftUI

struct AgentJob: Codable, Identifiable {
    let id: String
    let type: String
    let ref_id: String?
    let status: String
    let progress: Double
    let message: String
}
struct CampaignCreated: Decodable { let job: AgentJob }
struct BestHour: Decodable { let hour: Int; let basis: String; let samples: Int }
struct PlannerView: View {
    @EnvironmentObject private var store: Store
    @State private var month = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var count = 12
    @State private var brief = ""
    @State private var selected: Set<String> = ["instagram", "linkedin"]
    @State private var jobs: [AgentJob] = []
    @State private var submitting = false
    @State private var activeJob: String?
    @State private var designName: String?
    @State private var platforms: [String] = []
    @State private var best: BestHour?
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 18) {
                Label(designName.map { "Using \($0)" } ?? "Choose this client’s design system first", systemImage: "paintpalette.fill").foregroundStyle(designName == nil ? Color.orange : Color.teal)
                Text("Plan the month. Make every post count.").font(.title2.weight(.semibold))
                Text("Cadence drafts a varied month using this client’s saved guidelines and voice. Review the captions and image briefs before approval.").foregroundStyle(.secondary)
                HStack {
                    DatePicker("Month", selection: $month, displayedComponents: .date)
                    Stepper("\(count) posts", value: $count, in: 1...28).frame(width: 170)
                }
                Text("Channels").font(.headline)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 135), alignment: .leading)], alignment: .leading, spacing: 12) {
                    ForEach(platforms, id: \.self) { platform in
                        Toggle(platform.capitalized, isOn: Binding(get: { selected.contains(platform) }, set: { if $0 { selected.insert(platform) } else { selected.remove(platform) } }))
                    }
                }
                Text("What should this month focus on?").font(.headline)
                TextEditor(text: $brief).frame(minHeight: 130).padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
                Text(timingNote).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text("Generation uses your configured text provider.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(submitting ? "Starting…" : "Generate monthly drafts", systemImage: "sparkles") { generate() }.buttonStyle(.borderedProminent).disabled(submitting || selected.isEmpty || designName == nil)
                }
            }.padding(24).background(.background, in: RoundedRectangle(cornerRadius: 14))
            if let job = jobs.first(where: { $0.id == activeJob }) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Label("Monthly draft generation", systemImage: "sparkles"); Spacer(); StatusBadge(status: job.status) }
                    ProgressView(value: job.progress)
                    Text(job.message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    if job.status == "complete" { Text("Your drafts are ready in Approvals and Calendar.").foregroundStyle(.teal) }
                    if ["failed", "interrupted"].contains(job.status) { Button("Resume generation") { resume(job) } }
                }.padding(22).background(.background, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .task(id: store.selectedBrand) {
            if let caps: [Capability] = try? await store.request("/api/capabilities") { platforms = caps.filter { $0.available && $0.id != "mock" }.map(\.id) }
            await loadDesign()
            best = try? await store.request("/api/analytics/best-hour?brand_id=\(store.selectedBrand ?? "")")
            while !Task.isCancelled {
                await loadJobs()
                do { try await Task.sleep(for: .seconds(2)) } catch { break }
            }
        }
    }
    /// The server picks the hour from this client's own results, so say which hour it landed on and why.
    private var timingNote: String {
        let zone = TimeZone.current.identifier
        guard let best else { return "Include confirmed offers, audience, language, and important dates." }
        let when = "\(String(format: "%02d", best.hour)):00 in \(zone)"
        return best.basis == "analytics"
            ? "Include confirmed offers, audience, language, and important dates. Drafts are scheduled for \(when) — the hour this client's \(best.samples) measured posts performed best in."
            : "Include confirmed offers, audience, language, and important dates. Drafts are scheduled for \(when); once published posts have collected metrics, Cadence moves that to the hour that actually performs."
    }
    private func loadDesign() async {
        guard let id = store.selectedBrand else { return }
        do { let designs: [ClientDesign] = try await store.request("/api/brands/\(id)/design-systems"); designName = designs.first { $0.active == 1 }?.name }
        catch { store.error = error.localizedDescription }
    }
    private func loadJobs() async {
        do {
            let next: [AgentJob] = try await store.request("/api/jobs")
            let wasComplete = jobs.first { $0.id == activeJob }?.status == "complete"
            jobs = next
            if !wasComplete && jobs.first(where: { $0.id == activeJob })?.status == "complete" { await store.refresh() }
        } catch { /* The workspace exposes connection failures; polling should not repeat alerts. */ }
    }
    private func generate() {
        guard let brand = store.selectedBrand else { return }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM"
        submitting = true
        Task {
            defer { submitting = false }
            do {
                let result: CampaignCreated = try await store.request("/api/campaigns", method: "POST", body: ["brand_id": brand, "month": formatter.string(from: month), "count": count, "platforms": selected.sorted(), "brief": brief, "time_zone": TimeZone.current.identifier])
                activeJob = result.job.id; await loadJobs()
            } catch { store.error = error.localizedDescription }
        }
    }
    private func resume(_ job: AgentJob) {
        Task {
            do { let _: AgentJob = try await store.request("/api/jobs/\(job.id)/resume", method: "POST", body: [:]); await loadJobs() }
            catch { store.error = error.localizedDescription }
        }
    }
}
