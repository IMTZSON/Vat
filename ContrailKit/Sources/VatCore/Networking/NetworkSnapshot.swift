import Foundation

/// Immutable, indexed view of one data feed. Built in a single pass; cheap to share across actors.
public struct NetworkSnapshot: Sendable {
    /// The decoded feed.
    public let feed: VatsimFeed
    public let pilotsByCallsign: [String: Pilot]
    public let controllersByCallsign: [String: Controller]
    public let atisByCallsign: [String: Controller]
    /// Pilots keyed by CID (a CID is connected at most once as a pilot).
    public let pilotsByCID: [Int: Pilot]
    /// Controllers (excluding ATIS) keyed by CID.
    public let controllersByCID: [Int: Controller]
    /// Controllers and ATIS stations keyed by the first callsign component ("LIRF" for "LIRF_N_APP").
    private let stationsByPrefix: [String: [Controller]]
    private let departuresByICAO: [String: [Pilot]]
    private let arrivalsByICAO: [String: [Pilot]]

    public init(feed: VatsimFeed) {
        self.feed = feed
        var pilots = [String: Pilot](minimumCapacity: feed.pilots.count)
        var pilotsCID = [Int: Pilot](minimumCapacity: feed.pilots.count)
        var departures: [String: [Pilot]] = [:]
        var arrivals: [String: [Pilot]] = [:]
        for pilot in feed.pilots {
            pilots[pilot.callsign] = pilot
            if pilot.cid > 0 { pilotsCID[pilot.cid] = pilot }
            if let plan = pilot.flightPlan {
                if !plan.departure.isEmpty { departures[plan.departure, default: []].append(pilot) }
                if !plan.arrival.isEmpty { arrivals[plan.arrival, default: []].append(pilot) }
            }
        }
        var controllers = [String: Controller](minimumCapacity: feed.controllers.count)
        var controllersCID = [Int: Controller]()
        var byPrefix: [String: [Controller]] = [:]
        for controller in feed.controllers {
            controllers[controller.callsign] = controller
            if controller.cid > 0 { controllersCID[controller.cid] = controller }
            byPrefix[controller.callsignParts.prefix, default: []].append(controller)
        }
        var atis = [String: Controller](minimumCapacity: feed.atis.count)
        for station in feed.atis {
            atis[station.callsign] = station
            byPrefix[station.callsignParts.prefix, default: []].append(station)
        }
        pilotsByCallsign = pilots
        pilotsByCID = pilotsCID
        controllersByCallsign = controllers
        controllersByCID = controllersCID
        atisByCallsign = atis
        stationsByPrefix = byPrefix
        departuresByICAO = departures
        arrivalsByICAO = arrivals
    }

    /// Empty snapshot (useful as a placeholder in previews).
    public static let empty = NetworkSnapshot(feed: VatsimFeed())

    /// Feed generation time reported by VATSIM.
    public var updatedAt: Date? { feed.general.updateTimestamp }
    public var pilots: [Pilot] { feed.pilots }
    public var controllers: [Controller] { feed.controllers }
    public var atis: [Controller] { feed.atis }
    public var prefiles: [Prefile] { feed.prefiles }

    public func pilot(callsign: String) -> Pilot? { pilotsByCallsign[callsign.uppercased()] }
    public func pilot(cid: Int) -> Pilot? { pilotsByCID[cid] }
    /// Controller or ATIS station by callsign.
    public func controller(callsign: String) -> Controller? {
        let key = callsign.uppercased()
        return controllersByCallsign[key] ?? atisByCallsign[key]
    }
    /// Controller (not ATIS) by CID.
    public func controller(cid: Int) -> Controller? { controllersByCID[cid] }
    /// True when `cid` is connected as pilot or controller.
    public func isOnline(cid: Int) -> Bool { pilotsByCID[cid] != nil || controllersByCID[cid] != nil }

    /// Airport-related stations (DEL/GND/TWR/APP/DEP, excluding ATIS and CTR/FSS) whose callsign starts
    /// with `icao` or one of `aliases` (IATA/LID, e.g. "JFK" for KJFK), sorted from DEL to APP.
    public func controllers(forAirport icao: String, aliases: [String] = []) -> [Controller] {
        stations(icao: icao, aliases: aliases).filter {
            let p = $0.position
            return p != .atis && p != .center && p != .flightService && p != .observer && p != .supervisor
        }.sorted { ($0.position, $0.callsign) < ($1.position, $1.callsign) }
    }

    /// ATIS stations for an airport (e.g. "LIRF_ATIS", "KJFK_D_ATIS").
    public func atis(forAirport icao: String, aliases: [String] = []) -> [Controller] {
        stations(icao: icao, aliases: aliases).filter { $0.position == .atis }.sorted { $0.callsign < $1.callsign }
    }

    /// Pilots with a flight plan departing `icao`.
    public func departures(from icao: String) -> [Pilot] { departuresByICAO[icao.uppercased()] ?? [] }
    /// Pilots with a flight plan arriving at `icao`.
    public func arrivals(to icao: String) -> [Pilot] { arrivalsByICAO[icao.uppercased()] ?? [] }

    private func stations(icao: String, aliases: [String]) -> [Controller] {
        var keys = [icao.uppercased()]
        for alias in aliases where !alias.isEmpty && !keys.contains(alias.uppercased()) { keys.append(alias.uppercased()) }
        return keys.flatMap { stationsByPrefix[$0] ?? [] }
    }
}

/// Differences between two consecutive snapshots, used by the map to update annotations in place.
public struct FeedDiff: Sendable, Equatable {
    /// Pilots that connected.
    public var added: [Pilot]
    /// Callsigns of pilots that disconnected.
    public var removed: [String]
    /// Pilots whose position, altitude, heading, ground speed or flight plan changed.
    public var updated: [Pilot]
    /// Controllers and ATIS stations that connected.
    public var controllersAdded: [Controller]
    /// Callsigns of controllers/ATIS that disconnected.
    public var controllersRemoved: [String]
    /// Controllers/ATIS whose frequency, facility, rating, range, name or ATIS changed.
    public var controllersUpdated: [Controller]

    public init(added: [Pilot] = [], removed: [String] = [], updated: [Pilot] = [],
                controllersAdded: [Controller] = [], controllersRemoved: [String] = [],
                controllersUpdated: [Controller] = []) {
        self.added = added
        self.removed = removed
        self.updated = updated
        self.controllersAdded = controllersAdded
        self.controllersRemoved = controllersRemoved
        self.controllersUpdated = controllersUpdated
    }

    public static let empty = FeedDiff()

    public var isEmpty: Bool {
        added.isEmpty && removed.isEmpty && updated.isEmpty
            && controllersAdded.isEmpty && controllersRemoved.isEmpty && controllersUpdated.isEmpty
    }

    /// True when the set of controllers changed (sectors must be recomputed).
    public var controllersChanged: Bool {
        !controllersAdded.isEmpty || !controllersRemoved.isEmpty || !controllersUpdated.isEmpty
    }

    /// Computes the diff. With `old == nil` everything in `new` is "added".
    public static func between(old: NetworkSnapshot?, new: NetworkSnapshot) -> FeedDiff {
        guard let old else {
            return FeedDiff(added: new.pilots, controllersAdded: new.controllers + new.atis)
        }
        var diff = FeedDiff()
        for pilot in new.pilots {
            if let previous = old.pilotsByCallsign[pilot.callsign] {
                if pilotChanged(previous, pilot) { diff.updated.append(pilot) }
            } else {
                diff.added.append(pilot)
            }
        }
        for pilot in old.pilots where new.pilotsByCallsign[pilot.callsign] == nil {
            diff.removed.append(pilot.callsign)
        }
        func compare(_ newList: [Controller], _ newIndex: [String: Controller], _ oldList: [Controller],
                     _ oldIndex: [String: Controller]) {
            for station in newList {
                if let previous = oldIndex[station.callsign] {
                    if controllerChanged(previous, station) { diff.controllersUpdated.append(station) }
                } else {
                    diff.controllersAdded.append(station)
                }
            }
            for station in oldList where newIndex[station.callsign] == nil {
                diff.controllersRemoved.append(station.callsign)
            }
        }
        compare(new.controllers, new.controllersByCallsign, old.controllers, old.controllersByCallsign)
        compare(new.atis, new.atisByCallsign, old.atis, old.atisByCallsign)
        return diff
    }

    static func pilotChanged(_ a: Pilot, _ b: Pilot) -> Bool {
        a.latitude != b.latitude || a.longitude != b.longitude || a.altitude != b.altitude || a.heading != b.heading
            || a.groundspeed != b.groundspeed || a.flightPlan != b.flightPlan
    }

    static func controllerChanged(_ a: Controller, _ b: Controller) -> Bool {
        a.frequency != b.frequency || a.facility != b.facility || a.rating != b.rating || a.visualRange != b.visualRange
            || a.atisCode != b.atisCode || a.textAtis != b.textAtis || a.name != b.name || a.cid != b.cid
    }
}

/// Result of one ``FeedService/fetch()``.
public struct FeedUpdate: Sendable {
    public var snapshot: NetworkSnapshot
    /// Changes relative to the previous update delivered by the service.
    public var diff: FeedDiff
    /// When the bytes were downloaded (or stored in the cache).
    public var fetchedAt: Date
    /// False when no new data was downloaded (minimum interval not elapsed, 304, or older mirror data).
    public var isFresh: Bool
    /// True when the snapshot was loaded from the offline cache.
    public var isFromCache: Bool

    public init(snapshot: NetworkSnapshot, diff: FeedDiff, fetchedAt: Date, isFresh: Bool, isFromCache: Bool) {
        self.snapshot = snapshot
        self.diff = diff
        self.fetchedAt = fetchedAt
        self.isFresh = isFresh
        self.isFromCache = isFromCache
    }
}

/// Element of ``FeedService/updates(interval:)``.
public enum FeedResult: Sendable {
    case success(FeedUpdate)
    /// The poll failed; `lastGood` is the most recent snapshot available (memory or disk), if any.
    case failure(NetworkError, lastGood: FeedUpdate?)

    /// The best update available for display.
    public var update: FeedUpdate? {
        switch self {
        case let .success(update): update
        case let .failure(_, lastGood): lastGood
        }
    }

    public var error: NetworkError? {
        if case let .failure(error, _) = self { return error }
        return nil
    }
}
