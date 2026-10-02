import Foundation
import VatCore

/// All network clients, built once at launch. Every client is `Sendable` and safe to call from any task.
nonisolated struct AppServices: Sendable {
    let http: any HTTPClient
    let cache: ResponseCache
    let discovery: StatusDiscovery
    let feed: FeedService
    let transceivers: TransceiversClient
    let metar: MetarClient
    let bookings: BookingsClient
    let events: EventsClient
    let member: MemberClient
    let simBrief: SimBriefClient
    let weather: WeatherClient
    let mapData: MapDataClient

    static func live() -> AppServices {
        let http = URLSessionHTTPClient()
        let cache = ResponseCache(directory: ResponseCache.defaultDirectory)
        let discovery = StatusDiscovery(http: http, cache: cache)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MapData", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        return AppServices(
            http: http,
            cache: cache,
            discovery: discovery,
            feed: FeedService(http: http, discovery: discovery, cache: cache),
            transceivers: TransceiversClient(http: http, cache: cache, discovery: discovery),
            metar: MetarClient(http: http, cache: cache),
            bookings: BookingsClient(http: http, cache: cache),
            events: EventsClient(http: http, cache: cache),
            member: MemberClient(http: http, cache: cache),
            simBrief: SimBriefClient(http: http, cache: cache),
            weather: WeatherClient(http: http, cache: cache),
            mapData: MapDataClient(http: http, directory: support, bundled: BundledData.mapFiles)
        )
    }
}

/// Files shipped in App/Resources/Data (DECISIONS D-012, D-014).
nonisolated enum BundledData {
    static func url(_ name: String, _ ext: String) -> URL {
        Bundle.main.url(forResource: name, withExtension: ext)
            ?? Bundle.main.bundleURL.appendingPathComponent("\(name).\(ext)")
    }

    static var mapFiles: MapDataFiles {
        MapDataFiles(
            vatspyDat: url("VATSpy", "dat"),
            firBoundaries: url("FIRBoundaries", "geojson"),
            traconBoundaries: url("TRACONBoundaries", "geojson")
        )
    }

    static var airportExtras: URL { url("airport_extras", "csv") }
    static var navaids: URL { url("navaids", "csv") }
}

/// Static reference data (airports, navaids, sectors). Immutable and `Sendable`; built off the main actor.
nonisolated final class ReferenceData: Sendable {
    let sectors: SectorDatabase
    let navaids: NavaidDatabase
    /// Airports + navaids, for route resolution.
    let waypoints: CombinedWaypointLookup
    let activeSectorsBuilder: ActiveSectorsBuilder

    var airports: AirportDatabase { sectors.airports }

    init(sectors: SectorDatabase, navaids: NavaidDatabase) {
        self.sectors = sectors
        self.navaids = navaids
        self.waypoints = CombinedWaypointLookup([sectors.airports, navaids])
        self.activeSectorsBuilder = ActiveSectorsBuilder(sectors: sectors)
    }

    /// Parses the given map files (≈1 s on device). Call from a background task.
    nonisolated static func load(files: MapDataFiles) throws -> ReferenceData {
        let sectors = try SectorDatabase.load(files: files, airportExtras: BundledData.airportExtras)
        let csv = (try? String(contentsOf: BundledData.navaids, encoding: .utf8)) ?? ""
        return ReferenceData(sectors: sectors, navaids: NavaidDatabase(csv: csv))
    }
}
