import Foundation

@MainActor
final class LocalService {
    static let shared = LocalService()
    private var process: Process?
    private var output: FileHandle?
    func startIfNeeded() async throws {
        if await healthy() { return }
        guard let resources = Bundle.main.resourceURL else { throw APIError(message: "App resources could not be found.") }
        let runtime = resources.appendingPathComponent("runtime/node")
        let entry = resources.appendingPathComponent("server/src/index.js")
        guard FileManager.default.isExecutableFile(atPath: runtime.path), FileManager.default.fileExists(atPath: entry.path) else {
            throw APIError(message: "Start the local service with npm start --prefix server, or launch the packaged Cadence app.")
        }
        let directory = ProcessInfo.processInfo.environment["CADENCE_DIR"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cadence")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let log = directory.appendingPathComponent("desktop-service.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        let output = try FileHandle(forWritingTo: log)
        try output.seekToEnd()
        let process = Process()
        process.executableURL = runtime
        process.arguments = ["--no-warnings", entry.path]
        process.currentDirectoryURL = resources
        process.standardOutput = output
        process.standardError = output
        try process.run()
        self.process = process
        self.output = output
        for _ in 0..<40 {
            if await healthy() { return }
            if !process.isRunning { throw APIError(message: "The local service stopped during startup. See desktop-service.log in Cadence’s Application Support folder.") }
            try await Task.sleep(for: .milliseconds(150))
        }
        throw APIError(message: "The local service is taking longer than expected. Refresh to reconnect.")
    }
    private func healthy() async -> Bool {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8796/health")!)
        request.timeoutInterval = 1
        guard let (data, response) = try? await URLSession.shared.data(for: request), let http = response as? HTTPURLResponse, http.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return false }
        return body["app"] == "Cadence"
    }
}
