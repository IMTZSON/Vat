import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import VatCore

final class StatusDiscoveryTests: XCTestCase {
    func testParsesStatusDocument() throws {
        let status = try StatusDiscovery.parse(CoreFixtures.data("status.json"))
        XCTAssertEqual(status.feedURLs.count, 2)
        XCTAssertEqual(status.transceiversURLs.first?.absoluteString, "https://data.vatsim.net/v3/transceivers-data.json")
        XCTAssertEqual(status.metarURLs.first?.host, "metar.vatsim.net")
        XCTAssertEqual(status.userURLs.count, 1)
        // Garbage-tolerant.
        let partial = try StatusDiscovery.parse(Data(#"{"data": {"v3": "https://x.example/feed.json", "transceivers": [null, 5]}}"#.utf8))
        XCTAssertEqual(partial.feedURLs.map(\.absoluteString), ["https://x.example/feed.json"])
        XCTAssertTrue(partial.transceiversURLs.isEmpty)
    }

    func testPicksMirrorAndCachesForSixHours() async throws {
        let clock = CoreTestClock()
        let http = StubHTTPClient(routes: ["status.vatsim.net": .init(body: try CoreFixtures.data("status.json"))])
        let discovery = StatusDiscovery(http: http, now: clock.closure, randomIndex: { _ in 1 })
        let feed = await discovery.feedURL()
        XCTAssertEqual(feed.absoluteString, "https://mirror.example.net/v3/vatsim-data.json")
        _ = await discovery.transceiversURL()
        clock.advance(5 * 3600)
        _ = await discovery.feedURL()
        var count = await http.requestCount(matching: "status.json")
        XCTAssertEqual(count, 1)
        clock.advance(2 * 3600)
        _ = await discovery.feedURL()
        count = await http.requestCount(matching: "status.json")
        XCTAssertEqual(count, 2)
    }

    func testFallsBackToConstantsWhenOffline() async {
        let clock = CoreTestClock()
        let http = StubHTTPClient { _ in throw NetworkError.offline }
        let discovery = StatusDiscovery(http: http, now: clock.closure)
        let feed = await discovery.feedURL()
        let transceivers = await discovery.transceiversURL()
        XCTAssertEqual(feed, VatsimEndpoints.fallbackFeed)
        XCTAssertEqual(transceivers, VatsimEndpoints.fallbackTransceivers)
        // Failed discovery is not retried on every call.
        let count = await http.requestCount(matching: "status.json")
        XCTAssertEqual(count, 1)
    }

    func testUsesPersistedStatusWhenOffline() async throws {
        let cache = ResponseCache.inMemory()
        await cache.set("status.json", data: try CoreFixtures.data("status.json"), storedAt: Date(timeIntervalSince1970: 0))
        let http = StubHTTPClient { _ in throw NetworkError.offline }
        let discovery = StatusDiscovery(http: http, cache: cache, randomIndex: { _ in 0 })
        let feed = await discovery.feedURL()
        XCTAssertEqual(feed.absoluteString, "https://data.vatsim.net/v3/vatsim-data.json")
    }
}

final class ResponseCacheTests: XCTestCase {
    func testMemoryAndDiskWithMaxAge() async throws {
        let dir = CoreFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = CoreTestClock()
        let cache = ResponseCache(directory: dir, now: clock.closure)
        await cache.set("https://example.com/a?b=c", data: Data("hello".utf8))
        let hit = await cache.get("https://example.com/a?b=c", maxAge: 60)
        XCTAssertEqual(hit?.data, Data("hello".utf8))
        clock.advance(120)
        let expired = await cache.get("https://example.com/a?b=c", maxAge: 60)
        XCTAssertNil(expired)

        // A new instance reads the disk copy with its original timestamp.
        let reopened = ResponseCache(directory: dir, now: clock.closure)
        let disk = await reopened.get("https://example.com/a?b=c")
        XCTAssertEqual(disk?.data, Data("hello".utf8))
        XCTAssertEqual(disk?.storedAt.timeIntervalSince1970 ?? 0, 1_790_932_500, accuracy: 0.001)
        await reopened.remove("https://example.com/a?b=c")
        let removed = await ResponseCache(directory: dir).get("https://example.com/a?b=c")
        XCTAssertNil(removed)
    }

    func testFetcherServesStaleCacheWhenOffline() async throws {
        let clock = CoreTestClock()
        let cache = ResponseCache.inMemory()
        let http = StubHTTPClient(routes: ["events": .init(body: try CoreFixtures.data("events.json"))])
        let client = EventsClient(http: http, cache: cache, now: clock.closure)
        let first = try await client.events()
        XCTAssertEqual(first.source, .network)
        clock.advance(60)
        let cached = try await client.events()
        XCTAssertEqual(cached.source, .cache)
        var count = await http.requestCount(matching: "events")
        XCTAssertEqual(count, 1)

        clock.advance(3600)
        await http.setHandler { _ in throw NetworkError.offline }
        let stale = try await client.events()
        XCTAssertTrue(stale.isStale)
        XCTAssertEqual(stale.error, .offline)
        XCTAssertEqual(stale.value.count, first.value.count)
        count = await http.requestCount(matching: "events")
        XCTAssertEqual(count, 2)

        // 404 is not a connectivity problem: no stale fallback.
        await http.setHandler { _ in .init(status: 404) }
        do {
            _ = try await client.events()
            XCTFail("Expected error")
        } catch let error as NetworkError {
            XCTAssertEqual(error, .http(status: 404))
        }
    }

    func testRateLimitedCarriesRetryAfter() async {
        let http = StubHTTPClient { _ in .init(status: 429, headers: ["Retry-After": "30"]) }
        let client = MemberClient(http: http, cache: .inMemory())
        do {
            _ = try await client.stats(cid: 1)
            XCTFail("Expected error")
        } catch let error as NetworkError {
            XCTAssertEqual(error, .rateLimited(retryAfter: 30))
            XCTAssertEqual(error.errorDescription, "Too many requests. Try again in 30 s.")
        } catch {
            XCTFail("Unexpected \(error)")
        }
    }

    func testEndpointsBuilders() {
        XCTAssertEqual(VatsimEndpoints.metar(["lirf", "LIML"]).absoluteString, "https://metar.vatsim.net/LIRF,LIML")
        let date = Date(timeIntervalSince1970: 1_790_932_500)
        let bookings = VatsimEndpoints.bookings(date: date, type: .event, division: "EUD").absoluteString
        XCTAssertEqual(bookings, "https://atc-bookings.vatsim.net/api/booking?date=2026-10-02&type=event&division=EUD")
        XCTAssertEqual(VatsimEndpoints.simBrief(username: "pilot one").absoluteString,
                       "https://www.simbrief.com/api/xml.fetcher.php?username=pilot%20one&json=v2")
        let meteo = VatsimEndpoints.openMeteoWinds([GeoPoint(latitude: 45, longitude: 9), GeoPoint(latitude: 50.5, longitude: -10)])
        XCTAssertTrue(meteo.absoluteString.contains("latitude=45.00,50.50"))
        XCTAssertTrue(meteo.absoluteString.contains("longitude=9.00,-10.00"))
        XCTAssertTrue(meteo.absoluteString.contains("wind_speed_unit=kn"))
        XCTAssertEqual(VatsimEndpoints.memberStats(cid: 1234567).absoluteString, "https://api.vatsim.net/v2/members/1234567/stats")
    }
}

final class FeedServiceTests: XCTestCase {
    private func makeService(http: StubHTTPClient, clock: CoreTestClock, cache: ResponseCache? = nil,
                             sleep: @escaping @Sendable (Duration) async throws -> Void = { _ in }) -> FeedService {
        FeedService(http: http, discovery: nil, cache: cache, now: clock.closure, sleep: sleep)
    }

    func testMinimumIntervalBetweenRequests() async throws {
        let clock = CoreTestClock()
        let http = StubHTTPClient(routes: ["vatsim-data": .init(body: try CoreFixtures.data("vatsim-data-sample.json"))])
        let service = makeService(http: http, clock: clock)

        let first = try await service.fetch()
        XCTAssertTrue(first.isFresh)
        XCTAssertFalse(first.isFromCache)
        XCTAssertEqual(first.snapshot.pilots.count, 2)
        XCTAssertEqual(first.diff.added.count, 2)

        clock.advance(5)
        let second = try await service.fetch()
        XCTAssertFalse(second.isFresh)
        XCTAssertTrue(second.diff.isEmpty)
        XCTAssertEqual(second.snapshot.pilots.count, 2)
        var count = await http.requestCount(matching: "vatsim-data")
        XCTAssertEqual(count, 1)

        clock.advance(11)
        let third = try await service.fetch()
        XCTAssertTrue(third.isFresh)
        count = await http.requestCount(matching: "vatsim-data")
        XCTAssertEqual(count, 2)
    }

    func testConditionalRequestHeadersAnd304() async throws {
        let clock = CoreTestClock()
        let body = try CoreFixtures.data("vatsim-data-sample.json")
        let http = StubHTTPClient { request in
            if request.value(forHTTPHeaderField: "If-None-Match") == "\"v1\"" { return .init(status: 304) }
            return .init(body: body, headers: ["ETag": "\"v1\"", "Last-Modified": "Fri, 02 Oct 2026 09:15:00 GMT"])
        }
        let service = makeService(http: http, clock: clock)
        _ = try await service.fetch()
        clock.advance(15)
        let notModified = try await service.fetch()
        XCTAssertFalse(notModified.isFresh)
        XCTAssertEqual(notModified.snapshot.pilots.count, 2)
        let requests = await http.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertNil(requests[0].value(forHTTPHeaderField: "If-None-Match"))
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "If-None-Match"), "\"v1\"")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "If-Modified-Since"), "Fri, 02 Oct 2026 09:15:00 GMT")
    }

    func testOfflineFallsBackToDiskCache() async throws {
        let dir = CoreFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = CoreTestClock()
        let online = StubHTTPClient(routes: ["vatsim-data": .init(body: try CoreFixtures.data("vatsim-data-sample.json"))])
        _ = try await makeService(http: online, clock: clock, cache: ResponseCache(directory: dir)).fetch()

        // New launch, offline.
        let offline = StubHTTPClient { _ in throw NetworkError.offline }
        let service = makeService(http: offline, clock: clock, cache: ResponseCache(directory: dir))
        let cached = await service.cachedFeed()
        XCTAssertEqual(cached?.isFromCache, true)
        XCTAssertEqual(cached?.isFresh, false)
        XCTAssertEqual(cached?.snapshot.pilot(callsign: "AZA123")?.cid, 1234567)

        do {
            _ = try await service.fetch()
            XCTFail("Expected offline error")
        } catch let error as NetworkError {
            XCTAssertEqual(error, .offline)
        }

        clock.advance(20)
        let stream = service.updates()
        var iterator = stream.makeAsyncIterator()
        let element = await iterator.next()
        guard case let .failure(error, lastGood)? = element else { return XCTFail("Expected failure") }
        XCTAssertEqual(error, .offline)
        XCTAssertEqual(lastGood?.snapshot.pilots.count, 2)
        XCTAssertEqual(element?.update?.isFromCache, true)
    }

    func testDecodesOffTheMainThread() async throws {
        let body = try CoreFixtures.data("vatsim-data-sample.json")
        let http = StubHTTPClient(routes: ["vatsim-data": .init(body: body)])
        let service = FeedService(http: http)
        // Called from the main actor (as a view model would); the work hops to the service actor.
        let update = try await Self.fetchFromMainActor(service)
        XCTAssertEqual(update.snapshot.controllers.count, 3)
        XCTAssertEqual(update.snapshot.atis.count, 1)
    }

    @MainActor
    private static func fetchFromMainActor(_ service: FeedService) async throws -> FeedUpdate {
        try await service.fetch()
    }

    func testDiffAcrossFetchesAndOlderMirrorIgnored() async throws {
        let clock = CoreTestClock()
        let feeds = [
            CoreFixtures.feedJSON(timestamp: "2026-10-02T09:15:00Z",
                                  pilots: [("AAA1", 45, 9, 30000), ("BBB2", 46, 10, 20000), ("CCC3", 47, 11, 0)]),
            CoreFixtures.feedJSON(timestamp: "2026-10-02T09:15:15Z",
                                  pilots: [("AAA1", 45.1, 9, 30000), ("CCC3", 47, 11, 0), ("DDD4", 48, 12, 5000)]),
            CoreFixtures.feedJSON(timestamp: "2026-10-02T09:15:00Z", pilots: []),
        ]
        let counter = CoreRecorder<Int>()
        let http = StubHTTPClient { _ in
            await counter.append(1)
            let n = await counter.items.count
            return .init(body: feeds[min(n, feeds.count) - 1])
        }
        let service = makeService(http: http, clock: clock)
        _ = try await service.fetch()
        clock.advance(15)
        let update = try await service.fetch()
        XCTAssertEqual(update.diff.added.map(\.callsign), ["DDD4"])
        XCTAssertEqual(update.diff.removed, ["BBB2"])
        XCTAssertEqual(update.diff.updated.map(\.callsign), ["AAA1"])
        clock.advance(15)
        let older = try await service.fetch()
        XCTAssertFalse(older.isFresh)
        XCTAssertEqual(older.snapshot.pilots.count, 3)
    }

    func testBackoffSchedule() {
        let base = Duration.seconds(15)
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 0), .seconds(15))
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 1), .seconds(15))
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 2), .seconds(30))
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 3), .seconds(60))
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 4), .seconds(120))
        XCTAssertEqual(FeedService.backoff(interval: base, failures: 9), .seconds(120))
    }

    func testStreamBacksOffAndRecovers() async throws {
        let clock = CoreTestClock()
        let body = try CoreFixtures.data("vatsim-data-sample.json")
        let sleeps = CoreRecorder<Duration>()
        let calls = CoreRecorder<Int>()
        let http = StubHTTPClient { _ in
            await calls.append(1)
            if await calls.items.count <= 3 { throw NetworkError.offline }
            return .init(body: body)
        }
        let service = makeService(http: http, clock: clock) { duration in
            await sleeps.append(duration)
            clock.advance(TimeInterval(duration.components.seconds))
        }
        var results: [FeedResult] = []
        for await result in service.updates(interval: .seconds(15)) {
            results.append(result)
            if results.count == 5 { break }
        }
        XCTAssertEqual(results.prefix(3).compactMap(\.error), [.offline, .offline, .offline])
        XCTAssertEqual(results[3].update?.isFresh, true)
        XCTAssertNil(results[3].error)
        let recorded = await sleeps.items
        XCTAssertEqual(Array(recorded.prefix(4)), [.seconds(15), .seconds(30), .seconds(60), .seconds(15)])
    }
}

final class FeedDiffTests: XCTestCase {
    func testAddedRemovedUpdated() {
        let plan = FlightPlan(departure: "LIRF", arrival: "EGLL")
        let old = NetworkSnapshot(feed: VatsimFeed(
            pilots: [
                Pilot(cid: 1, callsign: "AAA1", latitude: 45, longitude: 9, altitude: 30000, groundspeed: 450, heading: 90),
                Pilot(cid: 2, callsign: "BBB2", latitude: 46, longitude: 10, altitude: 20000, flightPlan: plan),
                Pilot(cid: 3, callsign: "CCC3", latitude: 47, longitude: 11),
                Pilot(cid: 4, callsign: "EEE5", latitude: 40, longitude: 1, flightPlan: plan),
            ],
            controllers: [
                Controller(cid: 10, callsign: "LIRR_CTR", frequency: "125.500", facility: .center),
                Controller(cid: 11, callsign: "LIRF_TWR", frequency: "118.700", facility: .tower),
            ],
            atis: [Controller(cid: 12, callsign: "LIRF_ATIS", frequency: "121.700", facility: .tower, atisCode: "A")]
        ))
        var changedPlan = plan
        changedPlan.route = "DCT"
        let new = NetworkSnapshot(feed: VatsimFeed(
            pilots: [
                Pilot(cid: 1, callsign: "AAA1", latitude: 45, longitude: 9, altitude: 30000, groundspeed: 450, heading: 90,
                      lastUpdated: Date()), // only timestamp changed → not updated
                Pilot(cid: 2, callsign: "BBB2", latitude: 46, longitude: 10, altitude: 20100, flightPlan: plan),
                Pilot(cid: 4, callsign: "EEE5", latitude: 40, longitude: 1, flightPlan: changedPlan),
                Pilot(cid: 5, callsign: "DDD4", latitude: 48, longitude: 12),
            ],
            controllers: [
                Controller(cid: 10, callsign: "LIRR_CTR", frequency: "125.500", facility: .center, lastUpdated: Date()),
                Controller(cid: 13, callsign: "LIML_TWR", frequency: "119.250", facility: .tower),
            ],
            atis: [Controller(cid: 12, callsign: "LIRF_ATIS", frequency: "121.700", facility: .tower, atisCode: "B")]
        ))
        let diff = FeedDiff.between(old: old, new: new)
        XCTAssertEqual(diff.added.map(\.callsign), ["DDD4"])
        XCTAssertEqual(diff.removed, ["CCC3"])
        XCTAssertEqual(diff.updated.map(\.callsign), ["BBB2", "EEE5"])
        XCTAssertEqual(diff.controllersAdded.map(\.callsign), ["LIML_TWR"])
        XCTAssertEqual(diff.controllersRemoved, ["LIRF_TWR"])
        XCTAssertEqual(diff.controllersUpdated.map(\.callsign), ["LIRF_ATIS"])
        XCTAssertFalse(diff.isEmpty)
        XCTAssertTrue(FeedDiff.between(old: new, new: new).isEmpty)
        let initial = FeedDiff.between(old: nil, new: new)
        XCTAssertEqual(initial.added.count, 4)
        XCTAssertEqual(initial.controllersAdded.count, 3)
    }

    func testSnapshotHelpers() throws {
        let snapshot = NetworkSnapshot(feed: try VatsimFeed.decode(from: CoreFixtures.data("vatsim-data-sample.json")))
        XCTAssertEqual(snapshot.pilot(cid: 1234567)?.callsign, "AZA123")
        XCTAssertEqual(snapshot.pilot(callsign: "dlh4ab")?.cid, 7654321)
        XCTAssertEqual(snapshot.controllers(forAirport: "LIRF").map(\.callsign), ["LIRF_N_APP"])
        XCTAssertEqual(snapshot.atis(forAirport: "LIRF").first?.atisCode, "K")
        XCTAssertEqual(snapshot.controller(callsign: "LIRF_ATIS")?.atisCode, "K")
        XCTAssertEqual(snapshot.departures(from: "LIRF").map(\.callsign), ["AZA123"])
        XCTAssertEqual(snapshot.arrivals(to: "egll").count, 1)
        XCTAssertTrue(snapshot.isOnline(cid: 1111111))
        XCTAssertFalse(snapshot.isOnline(cid: 42))
    }
}

// MARK: - Shared test support (fixtures, clock, recorder)

/// Fixture loading for the data/network tests.
enum CoreFixtures {
    static func data(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"),
                                "Missing fixture \(name)")
        return try Data(contentsOf: url)
    }

    static func text(_ name: String) throws -> String {
        String(decoding: try data(name), as: UTF8.self)
    }

    /// Fresh temporary directory, removed by the caller's teardown if desired.
    static func temporaryDirectory() -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("contrail-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Minimal feed JSON with the given pilots `(callsign, lat, lon, altitude)`.
    static func feedJSON(timestamp: String = "2026-10-02T09:15:00Z",
                         pilots: [(String, Double, Double, Int)],
                         controllers: [(String, String, Int)] = []) -> Data {
        let pilotJSON = pilots.enumerated().map { i, p in
            #"{"cid": \#(1000 + i), "callsign": "\#(p.0)", "latitude": \#(p.1), "longitude": \#(p.2), "altitude": \#(p.3), "groundspeed": 250, "heading": 90}"#
        }.joined(separator: ",")
        let controllerJSON = controllers.enumerated().map { i, c in
            #"{"cid": \#(2000 + i), "callsign": "\#(c.0)", "frequency": "\#(c.1)", "facility": \#(c.2), "rating": 5}"#
        }.joined(separator: ",")
        return Data(#"{"general": {"version": 3, "update_timestamp": "\#(timestamp)"}, "pilots": [\#(pilotJSON)], "controllers": [\#(controllerJSON)], "atis": []}"#.utf8)
    }
}

/// Mutable clock for deterministic tests.
final class CoreTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_790_932_500)) { current = start }

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(seconds)
    }

    var closure: @Sendable () -> Date { { [self] in self.now } }
}

/// Thread-safe list recorder.
actor CoreRecorder<Element: Sendable> {
    private(set) var items: [Element] = []
    func append(_ item: Element) { items.append(item) }
}
