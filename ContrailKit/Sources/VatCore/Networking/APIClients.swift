import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Small API clients. Each one: cache-first within its freshness window, network otherwise, and the
// last cached copy (flagged `isStale`) when the network fails. See ``Fetched``.

/// Audio transceivers per callsign (frequencies and antenna positions).
public struct TransceiversClient: Sendable {
    /// The transceivers feed is regenerated every 15 s; poll at most once a minute (PLAN §4).
    public static let maxAge: TimeInterval = 60

    private let fetcher: CachedFetcher
    private let discovery: StatusDiscovery?

    public init(http: any HTTPClient, cache: ResponseCache, discovery: StatusDiscovery? = nil,
                now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
        self.discovery = discovery
    }

    /// Transceivers keyed by callsign (uppercase).
    public func transceivers() async throws -> Fetched<[String: [Transceiver]]> {
        let url = await discovery?.transceiversURL() ?? VatsimEndpoints.fallbackTransceivers
        return try await fetcher.fetch(CachedFetcher.get(url), key: "transceivers", maxAge: Self.maxAge,
                                       decode: TransceiverStation.decodeFeed)
    }
}

/// METAR text from metar.vatsim.net (cache 5 min per station, batched requests).
public struct MetarClient: Sendable {
    public static let maxAge: TimeInterval = 5 * 60

    private let http: any HTTPClient
    private let cache: ResponseCache
    private let now: @Sendable () -> Date

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        self.cache = cache
        self.now = now
    }

    /// Raw METAR for one station (`nil` value when the station has no report).
    public func metar(for icao: String) async throws -> Fetched<String?> {
        let key = icao.uppercased()
        return try await metars(for: [key]).map { $0[key] }
    }

    /// Decoded METAR for one station.
    public func decodedMetar(for icao: String) async throws -> Fetched<DecodedMetar?> {
        try await metar(for: icao).map { $0.flatMap(MetarDecoder.decode) }
    }

    /// Raw METARs for several stations in a single request; result keyed by uppercase ICAO.
    /// `isStale` is true if any value had to come from an expired cache entry.
    public func metars(for icaos: [String]) async throws -> Fetched<[String: String]> {
        let ids = Array(Set(icaos.map { $0.uppercased().trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).sorted()
        var result: [String: String] = [:]
        let start = now()
        var oldest = start
        var missing: [String] = []
        for id in ids {
            if let entry = await cache.get(Self.key(id)), entry.age(at: start) <= Self.maxAge {
                if let text = String(data: entry.data, encoding: .utf8), !text.isEmpty { result[id] = text }
                oldest = min(oldest, entry.storedAt)
            } else {
                missing.append(id)
            }
        }
        guard !missing.isEmpty else {
            return Fetched(value: result, fetchedAt: oldest, source: .cache)
        }
        do {
            var parsed: [String: String] = [:]
            for chunk in stride(from: 0, to: missing.count, by: 40).map({ Array(missing[$0..<min($0 + 40, missing.count)]) }) {
                let (data, response) = try await http.send(CachedFetcher.get(VatsimEndpoints.metar(chunk), accept: "text/plain"))
                try NetworkError.check(response)
                let text = String(decoding: data, as: UTF8.self)
                parsed.merge(Self.parseLines(text), uniquingKeysWith: { a, _ in a })
            }
            let date = now()
            for id in missing {
                // Store empty bodies too, so unknown stations are not re-requested for 5 minutes.
                await cache.set(Self.key(id), data: Data((parsed[id] ?? "").utf8), storedAt: date)
                if let metar = parsed[id] { result[id] = metar }
            }
            return Fetched(value: result, fetchedAt: min(oldest, date), source: .network)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            let wrapped = NetworkError.wrap(error)
            guard wrapped.allowsStaleFallback else { throw wrapped }
            var anyStale = false
            for id in missing {
                if let entry = await cache.get(Self.key(id)) {
                    anyStale = true
                    if let text = String(data: entry.data, encoding: .utf8), !text.isEmpty { result[id] = text }
                    oldest = min(oldest, entry.storedAt)
                }
            }
            guard anyStale || !result.isEmpty else { throw wrapped }
            return Fetched(value: result, fetchedAt: oldest, source: .staleCache, error: wrapped)
        }
    }

    /// Splits a multi-station response into `[ICAO: METAR]` (a leading "METAR"/"SPECI" is ignored).
    public static func parseLines(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            var words = trimmed.split(separator: " ")
            while let first = words.first, ["METAR", "SPECI", "COR"].contains(first) { words.removeFirst() }
            guard let station = words.first, station.count == 4, station.allSatisfy({ $0.isLetter || $0.isNumber }) else { continue }
            let key = station.uppercased()
            if result[key] == nil { result[key] = trimmed }
        }
        return result
    }

    private static func key(_ icao: String) -> String { "metar-\(icao)" }
}

/// ATC bookings (cache 10 min).
public struct BookingsClient: Sendable {
    public static let maxAge: TimeInterval = 10 * 60
    private let fetcher: CachedFetcher

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
    }

    /// Bookings matching the filters, sorted by start time. Broken records are skipped.
    public func bookings(date: Date? = nil, type: ATCBooking.Kind? = nil, division: String? = nil,
                         subdivision: String? = nil) async throws -> Fetched<[ATCBooking]> {
        let url = VatsimEndpoints.bookings(date: date, type: type, division: division, subdivision: subdivision)
        return try await fetcher.fetch(CachedFetcher.get(url), maxAge: Self.maxAge, decode: Self.decode)
    }

    /// Decodes the bookings payload (bare array or `{data: [...]}`).
    public static func decode(_ data: Data) throws -> [ATCBooking] {
        try JSONDecoder().decode(DataEnvelope<ATCBooking>.self, from: data).data.sorted {
            ($0.start, $0.callsign) < ($1.start, $1.callsign)
        }
    }
}

/// VATSIM events (cache 30 min).
public struct EventsClient: Sendable {
    public static let maxAge: TimeInterval = 30 * 60
    private let fetcher: CachedFetcher

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
    }

    /// Latest events sorted by start time.
    public func events() async throws -> Fetched<[VatsimEvent]> {
        try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.events), maxAge: Self.maxAge, decode: Self.decode)
    }

    /// Decodes `{ "data": [...] }` (or a bare array), sorted by start.
    public static func decode(_ data: Data) throws -> [VatsimEvent] {
        try JSONDecoder().decode(DataEnvelope<VatsimEvent>.self, from: data).data.sorted {
            ($0.start, $0.id) < ($1.start, $1.id)
        }
    }
}

/// Member statistics, details and flight plan history (cache 1 h).
public struct MemberClient: Sendable {
    public static let maxAge: TimeInterval = 3600
    private let fetcher: CachedFetcher

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
    }

    /// Hours per rating. Throws ``NetworkError/http(status:)`` 404 for unknown CIDs.
    public func stats(cid: Int) async throws -> Fetched<MemberStats> {
        try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.memberStats(cid: cid)), maxAge: Self.maxAge) { data in
            var stats = try JSONDecoder().decode(MemberStats.self, from: data)
            if stats.cid == 0 { stats.cid = cid }
            return stats
        }
    }

    /// Public member details (ratings, region/division, registration date).
    public func member(cid: Int) async throws -> Fetched<MemberInfo> {
        try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.member(cid: cid)), maxAge: Self.maxAge) { data in
            try JSONDecoder().decode(MemberInfo.self, from: data)
        }
    }

    /// Flight plan history (most recent first).
    public func flightPlans(cid: Int) async throws -> Fetched<[MemberFlightPlan]> {
        try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.memberFlightPlans(cid: cid)), maxAge: Self.maxAge) { data in
            try MemberFlightPlan.decodeList(data).sorted {
                ($0.filedAt ?? .distantPast, $0.id) > ($1.filedAt ?? .distantPast, $1.id)
            }
        }
    }
}

/// SimBrief latest OFP. Always hits the network (the user just generated a plan) but falls back
/// to the last downloaded OFP when offline.
public struct SimBriefClient: Sendable {
    private let fetcher: CachedFetcher

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
    }

    /// Latest OFP for a SimBrief username. Throws ``SimBriefError/userNotFound`` for unknown users.
    public func latestOFP(username: String) async throws -> Fetched<SimBriefOFP> {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SimBriefError.userNotFound }
        return try await fetch(VatsimEndpoints.simBrief(username: trimmed), key: "simbrief-u-\(trimmed.lowercased())")
    }

    /// Latest OFP for a numeric SimBrief Pilot ID.
    public func latestOFP(userID: String) async throws -> Fetched<SimBriefOFP> {
        let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SimBriefError.userNotFound }
        return try await fetch(VatsimEndpoints.simBrief(userID: trimmed), key: "simbrief-id-\(trimmed)")
    }

    private func fetch(_ url: URL, key: String) async throws -> Fetched<SimBriefOFP> {
        try await fetcher.fetch(CachedFetcher.get(url), key: key, maxAge: 0, mapStatus: { response, data in
            guard response.statusCode == 400 else { return nil }
            let body = String(decoding: data.prefix(500), as: UTF8.self).lowercased()
            if body.isEmpty || body.contains("unknown") || body.contains("user") { return SimBriefError.userNotFound }
            return SimBriefError.server("HTTP 400")
        }, decode: SimBriefOFP.decode)
    }
}

/// Radar, SIGMETs and winds aloft.
public struct WeatherClient: Sendable {
    public static let radarMaxAge: TimeInterval = 10 * 60
    public static let sigmetMaxAge: TimeInterval = 10 * 60
    public static let windsMaxAge: TimeInterval = 3600
    /// Open-Meteo locations per request (keeps URLs short).
    public static let openMeteoBatch = 100

    private let fetcher: CachedFetcher

    public init(http: any HTTPClient, cache: ResponseCache, now: @escaping @Sendable () -> Date = { Date() }) {
        fetcher = CachedFetcher(http: http, cache: cache, now: now)
    }

    /// RainViewer manifest.
    public func radarManifest() async throws -> Fetched<RadarManifest> {
        try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.rainViewer), maxAge: Self.radarMaxAge) { data in
            try JSONDecoder().decode(RadarManifest.self, from: data)
        }
    }

    /// International SIGMETs plus US AIRMETs/SIGMETs. If one product fails the other is still returned
    /// (flagged stale); throws only when both fail.
    public func sigmets() async throws -> Fetched<[Sigmet]> {
        let fetcher = self.fetcher
        async let international = Self.attempt {
            try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.internationalSigmets, accept: "application/geo+json"),
                                    maxAge: Self.sigmetMaxAge, decode: SigmetParser.parse)
        }
        let us = await Self.attempt {
            try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.airSigmets, accept: "application/geo+json"),
                                    maxAge: Self.sigmetMaxAge, decode: SigmetParser.parse)
        }
        let intl = await international
        switch (intl, us) {
        case let (.success(a), .success(b)):
            let source: FetchSource = a.isStale || b.isStale ? .staleCache
                : (a.source == .network || b.source == .network ? .network : .cache)
            return Fetched(value: a.value + b.value, fetchedAt: min(a.fetchedAt, b.fetchedAt), source: source,
                          error: a.error ?? b.error)
        case let (.success(a), .failure(error)), let (.failure(error), .success(a)):
            return Fetched(value: a.value, fetchedAt: a.fetchedAt, source: .staleCache, error: error)
        case let (.failure(error), .failure):
            throw error
        }
    }

    private static func attempt(_ body: @Sendable () async throws -> Fetched<[Sigmet]>) async -> Result<Fetched<[Sigmet]>, NetworkError> {
        do {
            return .success(try await body())
        } catch {
            return .failure(NetworkError.wrap(error))
        }
    }

    /// US FD winds aloft (`level` "low" 3000–39000 ft or "high"). Station positions are resolved
    /// through `airports` ("BOS" → KBOS, Alaska/Hawaii "P" prefix) when provided.
    public func windsAloftUS(high: Bool = false, airports: AirportDatabase? = nil) async throws -> Fetched<[WindsAloftStation]> {
        let url = high ? VatsimEndpoints.windsAloftHigh : VatsimEndpoints.windsAloftLow
        return try await fetcher.fetch(CachedFetcher.get(url, accept: "text/plain"), maxAge: Self.windsMaxAge) { data in
            let text = String(decoding: data, as: UTF8.self)
            return WindsAloftParser.parse(text) { id in
                guard let airports else { return nil }
                for candidate in ["K" + id, "P" + id, id] {
                    if let airport = airports.airport(icao: candidate) { return airport.position }
                }
                return airports.airport(iataOrLID: id)?.position
            }
        }
    }

    /// Global 250 hPa (~FL340) winds at `points` from Open-Meteo, batched.
    public func windsAloftGrid(points: [GeoPoint]) async throws -> Fetched<[WindSample]> {
        guard !points.isEmpty else { return Fetched(value: [], fetchedAt: Date(), source: .cache) }
        var samples: [WindSample] = []
        var oldest: Date?
        var stale = false
        var error: NetworkError?
        for start in stride(from: 0, to: points.count, by: Self.openMeteoBatch) {
            let batch = Array(points[start..<min(start + Self.openMeteoBatch, points.count)])
            let fetched = try await fetcher.fetch(CachedFetcher.get(VatsimEndpoints.openMeteoWinds(batch)),
                                                  maxAge: Self.windsMaxAge) { data in
                try OpenMeteoParser.parse(data, requested: batch)
            }
            samples += fetched.value
            oldest = min(oldest ?? fetched.fetchedAt, fetched.fetchedAt)
            stale = stale || fetched.isStale
            error = error ?? fetched.error
        }
        return Fetched(value: samples, fetchedAt: oldest ?? Date(), source: stale ? .staleCache : .network, error: error)
    }

    /// A regular grid of points covering `bounds` (at most `maxPoints`, spacing grows as needed).
    public static func grid(in bounds: GeoBounds, spacingDegrees: Double = 5, maxPoints: Int = 400) -> [GeoPoint] {
        let lonSpan = bounds.crossesAntimeridian ? bounds.maxLon + 360 - bounds.minLon : bounds.maxLon - bounds.minLon
        let latSpan = bounds.maxLat - bounds.minLat
        var spacing = max(0.25, spacingDegrees)
        while ((latSpan / spacing + 1) * (lonSpan / spacing + 1)) > Double(maxPoints) { spacing *= 1.5 }
        var points: [GeoPoint] = []
        var lat = (bounds.minLat / spacing).rounded(.up) * spacing
        while lat <= bounds.maxLat {
            var lon = (bounds.minLon / spacing).rounded(.up) * spacing
            while lon <= bounds.minLon + lonSpan {
                points.append(GeoPoint(latitude: lat, longitude: GeoPoint.normalizeLongitude(lon)))
                lon += spacing
            }
            lat += spacing
        }
        return points
    }
}
