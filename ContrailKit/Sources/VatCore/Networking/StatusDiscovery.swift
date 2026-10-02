import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Discovers the VATSIM data feed mirrors from `status.json` (refreshed every 6 h) and falls back
/// to the well-known URLs when discovery fails.
public actor StatusDiscovery {
    /// How long a downloaded status document is trusted.
    public static let refreshInterval: TimeInterval = 6 * 3600
    /// Minimum delay before retrying after a failed discovery.
    public static let retryInterval: TimeInterval = 300

    private let http: any HTTPClient
    private let cache: ResponseCache?
    private let now: @Sendable () -> Date
    private let pick: @Sendable (Int) -> Int

    private var status: VatsimStatus?
    private var fetchedAt: Date?
    private var lastFailure: Date?
    private var chosenFeed: URL?
    private var chosenTransceivers: URL?

    /// - Parameters:
    ///   - cache: Optional persistent cache so the last status survives restarts.
    ///   - now: Clock (injectable for tests).
    ///   - randomIndex: Returns an index in `0..<count` to pick a mirror (injectable for tests).
    public init(http: any HTTPClient, cache: ResponseCache? = nil,
                now: @escaping @Sendable () -> Date = { Date() },
                randomIndex: @escaping @Sendable (Int) -> Int = { Int.random(in: 0..<max(1, $0)) }) {
        self.http = http
        self.cache = cache
        self.now = now
        self.pick = randomIndex
    }

    /// Current status document, refreshing it when older than 6 h. `nil` if never obtained.
    public func currentStatus() async -> VatsimStatus? {
        await refreshIfNeeded()
        return status
    }

    /// Data feed v3 URL (a random mirror, stable until the next refresh) or the fallback constant.
    public func feedURL() async -> URL {
        await refreshIfNeeded()
        return chosenFeed ?? VatsimEndpoints.fallbackFeed
    }

    /// Transceivers feed URL or the fallback constant.
    public func transceiversURL() async -> URL {
        await refreshIfNeeded()
        return chosenTransceivers ?? VatsimEndpoints.fallbackTransceivers
    }

    /// Forces the next call to download status.json again.
    public func invalidate() {
        fetchedAt = nil
        lastFailure = nil
    }

    /// Parses a status.json payload.
    public static func parse(_ data: Data) throws -> VatsimStatus {
        do {
            return try JSONDecoder().decode(VatsimStatus.self, from: data)
        } catch {
            throw NetworkError.decoding("status.json: \(error)")
        }
    }

    // MARK: - Private

    private func refreshIfNeeded() async {
        let current = now()
        if let fetchedAt, current.timeIntervalSince(fetchedAt) < Self.refreshInterval { return }
        if let lastFailure, current.timeIntervalSince(lastFailure) < Self.retryInterval { return }

        if status == nil, let cache, let entry = await cache.get("status.json"), let cached = try? Self.parse(entry.data) {
            apply(cached)
            if current.timeIntervalSince(entry.storedAt) < Self.refreshInterval {
                fetchedAt = entry.storedAt
                return
            }
        }

        do {
            var request = URLRequest(url: VatsimEndpoints.status)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await http.send(request)
            try NetworkError.check(response)
            let parsed = try Self.parse(data)
            guard !parsed.feedURLs.isEmpty else { throw NetworkError.decoding("status.json has no v3 feed") }
            apply(parsed)
            fetchedAt = current
            lastFailure = nil
            await cache?.set("status.json", data: data, storedAt: current)
        } catch {
            lastFailure = current
        }
    }

    private func apply(_ newStatus: VatsimStatus) {
        status = newStatus
        if !newStatus.feedURLs.isEmpty {
            let index = min(max(0, pick(newStatus.feedURLs.count)), newStatus.feedURLs.count - 1)
            chosenFeed = newStatus.feedURLs[index]
        }
        if !newStatus.transceiversURLs.isEmpty {
            let index = min(max(0, pick(newStatus.transceiversURLs.count)), newStatus.transceiversURLs.count - 1)
            chosenTransceivers = newStatus.transceiversURLs[index]
        }
    }
}
