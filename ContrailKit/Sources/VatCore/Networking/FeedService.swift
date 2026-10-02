import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Downloads the VATSIM data feed v3, never more often than every 15 s, with conditional requests,
/// background decoding, a persistent offline copy and a diff against the previous snapshot.
///
/// ```swift
/// let service = FeedService(http: URLSessionHTTPClient(), discovery: discovery, cache: cache)
/// if let cached = await service.cachedFeed() { show(cached) }
/// for await result in service.updates() { apply(result) }
/// ```
public actor FeedService {
    /// The feed is regenerated every 15 s; polling faster is pointless and against VATSIM policy.
    public static let minimumInterval: TimeInterval = 15
    /// Backoff cap after consecutive failures.
    public static let maximumBackoff: Duration = .seconds(120)
    static let cacheKey = "vatsim-data-v3.json"

    private let http: any HTTPClient
    private let discovery: StatusDiscovery?
    private let cache: ResponseCache?
    private let minimumInterval: TimeInterval
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void

    private var last: FeedUpdate?
    private var lastRequestAt: Date?
    private var lastError: NetworkError?
    private var etag: String?
    private var lastModified: String?

    /// - Parameters:
    ///   - discovery: Mirror discovery; `nil` uses ``VatsimEndpoints/fallbackFeed``.
    ///   - cache: Persistent cache for offline start; `nil` disables it.
    ///   - minimumInterval: Minimum seconds between network requests (clamped to ≥ 15 s in production;
    ///     tests may pass a smaller value).
    ///   - now: Clock (injectable for tests).
    ///   - sleep: Sleep used between polls (injectable for tests).
    public init(http: any HTTPClient, discovery: StatusDiscovery? = nil, cache: ResponseCache? = nil,
                minimumInterval: TimeInterval = FeedService.minimumInterval,
                now: @escaping @Sendable () -> Date = { Date() },
                sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.http = http
        self.discovery = discovery
        self.cache = cache
        self.minimumInterval = minimumInterval
        self.now = now
        self.sleep = sleep
    }

    /// The most recent update delivered (network or cache).
    public var latest: FeedUpdate? { last }

    /// Downloads the feed if at least `minimumInterval` elapsed since the previous request; otherwise
    /// returns the last update with `isFresh == false` and an empty diff.
    /// - Throws: ``NetworkError`` when the request fails (use ``cachedFeed()`` or the `lastGood`
    ///   payload of ``updates(interval:)`` to keep showing data).
    public func fetch() async throws -> FeedUpdate {
        let start = now()
        if let lastRequestAt, start.timeIntervalSince(lastRequestAt) < minimumInterval {
            if let last { return unchanged(last) }
            throw lastError ?? NetworkError.rateLimited(retryAfter: minimumInterval - start.timeIntervalSince(lastRequestAt))
        }
        lastRequestAt = start

        let url = await discovery?.feedURL() ?? VatsimEndpoints.fallbackFeed
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let last, !last.isFromCache {
            if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            if let lastModified { request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since") }
        }

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await http.send(request)
            try NetworkError.check(response)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            let wrapped = NetworkError.wrap(error)
            lastError = wrapped
            if wrapped != .offline { await discovery?.invalidate() }
            throw wrapped
        }

        if response.statusCode == 304, let last {
            lastError = nil
            return unchanged(last)
        }

        let feed: VatsimFeed
        do {
            feed = try VatsimFeed.decode(from: data)
        } catch {
            let wrapped = NetworkError.decoding("vatsim-data.json: \(error)")
            lastError = wrapped
            throw wrapped
        }
        lastError = nil
        etag = response.value(forHTTPHeaderField: "ETag")
        lastModified = response.value(forHTTPHeaderField: "Last-Modified")

        // A lagging mirror may serve an older generation than the one already shown: ignore it.
        if let last, let previous = last.snapshot.updatedAt, let current = feed.general.updateTimestamp,
           current < previous {
            return unchanged(last)
        }

        let snapshot = NetworkSnapshot(feed: feed)
        let update = FeedUpdate(snapshot: snapshot, diff: FeedDiff.between(old: last?.snapshot, new: snapshot),
                                fetchedAt: start, isFresh: true, isFromCache: false)
        last = update
        await cache?.set(Self.cacheKey, data: data, storedAt: start)
        return update
    }

    /// Loads the last feed saved on disk (for an instant, offline-capable start). When no update
    /// has been delivered yet, the cached one becomes the baseline for the next diff.
    public func cachedFeed() async -> FeedUpdate? {
        if let last, last.isFromCache { return last }
        guard let cache, let entry = await cache.get(Self.cacheKey),
              let feed = try? VatsimFeed.decode(from: entry.data) else { return nil }
        let snapshot = NetworkSnapshot(feed: feed)
        let update = FeedUpdate(snapshot: snapshot, diff: FeedDiff.between(old: nil, new: snapshot),
                                fetchedAt: entry.storedAt, isFresh: false, isFromCache: true)
        if last == nil { last = update }
        return update
    }

    /// Polls the feed while the stream is iterated. Cancelling the consuming task stops polling.
    /// Errors are delivered as `.failure` with exponential backoff (interval, ×2, … up to 120 s).
    public nonisolated func updates(interval: Duration = .seconds(15)) -> AsyncStream<FeedResult> {
        // Unbounded buffer: dropping an element would lose its diff.
        AsyncStream { continuation in
            let task = Task {
                await self.poll(interval: interval, continuation: continuation)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Delay before the next poll after `failures` consecutive failures.
    public static func backoff(interval: Duration, failures: Int) -> Duration {
        guard failures > 0 else { return interval }
        var delay = interval
        for _ in 1..<failures {
            delay = delay * 2
            if delay >= maximumBackoff { return maximumBackoff }
        }
        return min(delay, maximumBackoff)
    }

    // MARK: - Private

    private func unchanged(_ update: FeedUpdate) -> FeedUpdate {
        var copy = update
        copy.diff = .empty
        copy.isFresh = false
        return copy
    }

    private func poll(interval: Duration, continuation: AsyncStream<FeedResult>.Continuation) async {
        let minimum = Duration.milliseconds(Int64(minimumInterval * 1000))
        let baseInterval = max(interval, minimum)
        var failures = 0
        while !Task.isCancelled {
            do {
                let update = try await fetch()
                failures = 0
                continuation.yield(.success(update))
            } catch is CancellationError {
                return
            } catch {
                failures += 1
                let lastGood: FeedUpdate?
                if let last { lastGood = last } else { lastGood = await cachedFeed() }
                continuation.yield(.failure(NetworkError.wrap(error), lastGood: lastGood))
            }
            do {
                try await sleep(Self.backoff(interval: baseInterval, failures: failures))
            } catch {
                return
            }
        }
    }
}
