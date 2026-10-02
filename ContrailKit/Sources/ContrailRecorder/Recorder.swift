import Dispatch
import Foundation
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import VatCore

func log(_ message: String) {
    let line = "\(FastISO8601.string(from: Date())) \(message)\n"
    FileHandle.standardError.write(Data(line.utf8))
}

enum FetchError: Error, CustomStringConvertible {
    case http(Int, URL)
    case noFeedURL

    var description: String {
        switch self {
        case .http(let code, let url): "HTTP \(code) from \(url.absoluteString)"
        case .noFeedURL: "status.json has no data.v3 URL"
        }
    }
}

/// Installs SIGINT/SIGTERM handlers on a private queue (nonisolated: top-level code is main-actor isolated,
/// and the handlers must not assume the main executor).
func installSignalHandlers(_ onSignal: @escaping @Sendable () -> Void) -> [DispatchSourceSignal] {
    let queue = DispatchQueue(label: "contrail-recorder.signals")
    return [SIGINT, SIGTERM].map { sig in
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: queue)
        source.setEventHandler { @Sendable in
            log("received signal \(sig), shutting down")
            onSignal()
        }
        source.resume()
        return source
    }
}

/// Minimal HTTP client on plain URLSession (FoundationNetworking on Linux).
struct HTTPFetcher: Sendable {
    let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        config.httpAdditionalHeaders = ["User-Agent": "Contrail-Recorder/1.0 (+https://github.com/)", "Accept": "application/json"]
        session = URLSession(configuration: config)
    }

    func get(_ url: URL) async throws -> Data {
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        let session = self.session
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            let task = session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let data else {
                    continuation.resume(throwing: FetchError.http(status, url))
                    return
                }
                continuation.resume(returning: data)
            }
            task.resume()
        }
    }
}

/// `status.json` → `data.v3[]`.
struct StatusDocument: Decodable {
    struct DataURLs: Decodable {
        var v3: [String]?
    }
    var data: DataURLs?
}

/// Polling loop: discover → fetch → convert → store → index → retention.
actor Recorder {
    let options: RecorderOptions
    let store: SnapshotStore
    let fetcher = HTTPFetcher()

    private var feedURL: URL?
    private var feedURLResolvedAt: Date?
    private var lastStoredTimestamp: Date?
    private var lastPurge: Date?
    private var consecutiveFailures = 0

    init(options: RecorderOptions) {
        self.options = options
        self.store = SnapshotStore(directory: options.output, retention: SnapshotRetention(days: options.retentionDays))
    }

    /// Feed URL from status.json, refreshed every 6 h, with a static fallback.
    func resolveFeedURL(now: Date) async -> URL {
        if let override = options.feedURLOverride { return override }
        if let feedURL, let at = feedURLResolvedAt, now.timeIntervalSince(at) < 6 * 3600 { return feedURL }
        do {
            let data = try await fetcher.get(options.statusURL)
            let status = try JSONDecoder().decode(StatusDocument.self, from: data)
            guard let first = status.data?.v3?.first, let url = URL(string: first) else { throw FetchError.noFeedURL }
            feedURL = url
            feedURLResolvedAt = now
            return url
        } catch {
            log("status.json unavailable (\(error)); using \(options.fallbackFeedURL.absoluteString)")
            feedURLResolvedAt = now.addingTimeInterval(-6 * 3600 + 600) // retry discovery in 10 min
            feedURL = feedURL ?? options.fallbackFeedURL
            return feedURL ?? options.fallbackFeedURL
        }
    }

    /// One fetch/store cycle. Returns true when a new snapshot was written.
    @discardableResult
    func cycle() async throws -> Bool {
        let now = Date()
        let url = await resolveFeedURL(now: now)
        let data = try await fetcher.get(url)
        let feed = try VatsimFeed.decode(from: data)
        let timestamp = feed.general.updateTimestamp ?? now
        if let last = lastStoredTimestamp, Int(last.timeIntervalSince1970) == Int(timestamp.timeIntervalSince1970) {
            return false // feed not regenerated yet
        }
        let snapshot = CompactSnapshot(snapshot: feed, at: timestamp)
        let encoded = SnapshotCodec.encode(snapshot)
        try await store.append(encoded: encoded, timestamp: timestamp)
        lastStoredTimestamp = timestamp
        try await store.writeHourIndex(for: timestamp)

        if lastPurge.map({ now.timeIntervalSince($0) > 3600 }) ?? true {
            let removed = await store.applyRetention(now: now)
            lastPurge = now
            if removed > 0 { log("retention: removed \(removed) snapshots older than \(options.retentionDays) days") }
        }
        try await store.writeIndex(now: now)
        log("stored \(snapshot.pilots.count) pilots, \(snapshot.controllers.count) ATC, \(encoded.count) bytes @ \(FastISO8601.string(from: timestamp))")
        return true
    }

    /// Runs until the task is cancelled.
    func run() async {
        log("recording into \(options.output.path) every \(Int(options.interval)) s, retention \(options.retentionDays) days")
        while !Task.isCancelled {
            let started = Date()
            var delay = options.interval
            do {
                try await cycle()
                consecutiveFailures = 0
            } catch is CancellationError {
                break
            } catch {
                consecutiveFailures += 1
                delay = min(300, options.interval * pow(2, Double(min(consecutiveFailures, 5))))
                log("error (\(consecutiveFailures)): \(error); retrying in \(Int(delay)) s")
            }
            // Never poll more often than the feed is regenerated (15 s), measured from the cycle start.
            let wait = max(RecorderOptions.minimumInterval, delay) - Date().timeIntervalSince(started)
            if wait > 0 {
                do { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) } catch { break }
            }
        }
        log("stopped")
    }
}
