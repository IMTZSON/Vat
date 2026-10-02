import Foundation
import VatCore

/// Small, glanceable state written by the app and read by widgets, Live Activities and the watch.
/// Stored as JSON in the App Group container (`group.info.everyapp.contrail`).
public struct WidgetSnapshot: Codable, Sendable, Hashable {
    public var updatedAt: Date
    public var friendsOnline: [FriendStatus]
    public var favoriteAirports: [AirportATCSummary]
    public var nextEvent: EventSummary?
    public var followedFlights: [TrackedFlightSummary]

    public init(updatedAt: Date = .now, friendsOnline: [FriendStatus] = [], favoriteAirports: [AirportATCSummary] = [],
                nextEvent: EventSummary? = nil, followedFlights: [TrackedFlightSummary] = []) {
        self.updatedAt = updatedAt
        self.friendsOnline = friendsOnline
        self.favoriteAirports = favoriteAirports
        self.nextEvent = nextEvent
        self.followedFlights = followedFlights
    }

    public static let placeholder = WidgetSnapshot(
        updatedAt: .now,
        friendsOnline: [
            FriendStatus(cid: 1_234_567, displayName: "Marco", callsign: "AZA123", role: .pilot, detail: "LIRF → EGLL", altitudeFt: 36_000),
            FriendStatus(cid: 7_654_321, displayName: "Giulia", callsign: "LIRR_CTR", role: .controller, detail: "125.500"),
        ],
        favoriteAirports: [
            AirportATCSummary(icao: "LIRF", name: "Roma Fiumicino", positions: ["TWR", "GND", "APP"], atisCode: "K", state: .online),
            AirportATCSummary(icao: "LIML", name: "Milano Linate", positions: ["TWR"], atisCode: nil, state: .booked, bookedFrom: .now.addingTimeInterval(3600)),
        ],
        nextEvent: EventSummary(id: 1, name: "Italian Night Ops", start: .now.addingTimeInterval(7200), end: .now.addingTimeInterval(14_400), airports: ["LIRF", "LIML"], bannerURL: nil),
        followedFlights: [
            TrackedFlightSummary(callsign: "AZA123", departure: "LIRF", arrival: "EGLL", phase: "Cruise", phaseSymbol: "airplane", altitudeFt: 36_000, groundspeedKt: 452, progress: 0.42, eta: .now.addingTimeInterval(5400), remainingNM: 460),
        ]
    )
}

public struct FriendStatus: Codable, Sendable, Hashable, Identifiable {
    public enum Role: String, Codable, Sendable, Hashable { case pilot, controller, atis }
    public var cid: Int
    public var displayName: String
    public var callsign: String
    public var role: Role
    /// Route ("LIRF → EGLL") or frequency.
    public var detail: String
    public var altitudeFt: Int?

    public var id: Int { cid }

    public init(cid: Int, displayName: String, callsign: String, role: Role, detail: String, altitudeFt: Int? = nil) {
        self.cid = cid
        self.displayName = displayName
        self.callsign = callsign
        self.role = role
        self.detail = detail
        self.altitudeFt = altitudeFt
    }
}

public struct AirportATCSummary: Codable, Sendable, Hashable, Identifiable {
    public var icao: String
    public var name: String
    /// Online positions, e.g. ["DEL", "GND", "TWR", "APP"].
    public var positions: [String]
    public var atisCode: String?
    public var state: CoverageState
    public var bookedFrom: Date?

    public var id: String { icao }

    public init(icao: String, name: String, positions: [String], atisCode: String?, state: CoverageState, bookedFrom: Date? = nil) {
        self.icao = icao
        self.name = name
        self.positions = positions
        self.atisCode = atisCode
        self.state = state
        self.bookedFrom = bookedFrom
    }
}

public struct EventSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var name: String
    public var start: Date
    public var end: Date
    public var airports: [String]
    public var bannerURL: URL?

    public init(id: Int, name: String, start: Date, end: Date, airports: [String], bannerURL: URL?) {
        self.id = id
        self.name = name
        self.start = start
        self.end = end
        self.airports = airports
        self.bannerURL = bannerURL
    }
}

public struct TrackedFlightSummary: Codable, Sendable, Hashable, Identifiable {
    public var callsign: String
    public var departure: String
    public var arrival: String
    /// Localised phase title.
    public var phase: String
    public var phaseSymbol: String
    public var altitudeFt: Int
    public var groundspeedKt: Int
    /// 0…1
    public var progress: Double
    public var eta: Date?
    public var remainingNM: Double

    public var id: String { callsign }

    public init(callsign: String, departure: String, arrival: String, phase: String, phaseSymbol: String, altitudeFt: Int,
                groundspeedKt: Int, progress: Double, eta: Date?, remainingNM: Double) {
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.phase = phase
        self.phaseSymbol = phaseSymbol
        self.altitudeFt = altitudeFt
        self.groundspeedKt = groundspeedKt
        self.progress = progress
        self.eta = eta
        self.remainingNM = remainingNM
    }
}

/// Reads/writes `WidgetSnapshot` in the App Group container. Thread-safe (file IO only).
public enum SharedStore {
    public static let appGroup = "group.info.everyapp.contrail"
    public static let watchAppGroup = "group.info.everyapp.contrail.watch"
    static let fileName = "widget-snapshot.json"

    /// Container directory for the current process (falls back to Caches outside an App Group).
    public static func containerURL(group: String = appGroup) -> URL {
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) {
            return url
        }
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    public static func load(group: String = appGroup) -> WidgetSnapshot? {
        let url = containerURL(group: group).appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: WidgetSnapshot, group: String = appGroup) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(snapshot) else { return }
        let url = containerURL(group: group).appendingPathComponent(fileName)
        try? data.write(to: url, options: .atomic)
    }

    /// Shared defaults (user settings that widgets need, e.g. CID, favourite airports).
    public static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
}

/// Keys for settings shared through `SharedStore.defaults` and iCloud key-value store.
public enum SharedKeys {
    public static let userCID = "userCID"
    public static let favoriteAirports = "favoriteAirports"
    public static let friendCIDs = "friendCIDs"
    public static let followedCallsigns = "followedCallsigns"
    public static let simbriefUsername = "simbriefUsername"
}
