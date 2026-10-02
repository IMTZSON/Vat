import Foundation

// VATSIM data feed v3 (https://data.vatsim.net/v3/vatsim-data.json, discovered via status.json).
// Every field is decoded leniently (DECISIONS D-011): missing or malformed values fall back to
// sensible defaults and broken records are skipped one by one.

public struct VatsimFeed: Decodable, Sendable, Equatable {
    public var general: FeedGeneral
    public var pilots: [Pilot]
    public var controllers: [Controller]
    public var atis: [Controller]
    public var servers: [Server]
    public var prefiles: [Prefile]
    public var facilities: [ReferenceEntry]
    public var ratings: [ReferenceEntry]
    public var pilotRatings: [ReferenceEntry]
    public var militaryRatings: [ReferenceEntry]

    public init(
        general: FeedGeneral = FeedGeneral(),
        pilots: [Pilot] = [],
        controllers: [Controller] = [],
        atis: [Controller] = [],
        servers: [Server] = [],
        prefiles: [Prefile] = [],
        facilities: [ReferenceEntry] = [],
        ratings: [ReferenceEntry] = [],
        pilotRatings: [ReferenceEntry] = [],
        militaryRatings: [ReferenceEntry] = []
    ) {
        self.general = general
        self.pilots = pilots
        self.controllers = controllers
        self.atis = atis
        self.servers = servers
        self.prefiles = prefiles
        self.facilities = facilities
        self.ratings = ratings
        self.pilotRatings = pilotRatings
        self.militaryRatings = militaryRatings
    }

    enum CodingKeys: String, CodingKey {
        case general, pilots, controllers, atis, servers, prefiles, facilities, ratings
        case pilotRatings = "pilot_ratings"
        case militaryRatings = "military_ratings"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        general = c.lenient(FeedGeneral.self, forKey: .general) ?? FeedGeneral()
        pilots = c.lossyArray(Pilot.self, forKey: .pilots).filter { !$0.callsign.isEmpty }
        controllers = c.lossyArray(Controller.self, forKey: .controllers).filter { !$0.callsign.isEmpty }
        atis = c.lossyArray(Controller.self, forKey: .atis).filter { !$0.callsign.isEmpty }
        servers = c.lossyArray(Server.self, forKey: .servers)
        prefiles = c.lossyArray(Prefile.self, forKey: .prefiles)
        facilities = c.lossyArray(ReferenceEntry.self, forKey: .facilities)
        ratings = c.lossyArray(ReferenceEntry.self, forKey: .ratings)
        pilotRatings = c.lossyArray(ReferenceEntry.self, forKey: .pilotRatings)
        militaryRatings = c.lossyArray(ReferenceEntry.self, forKey: .militaryRatings)
    }

    /// Decodes a feed from raw JSON. Throws only if the payload is not a JSON object at all.
    public static func decode(from data: Data) throws -> VatsimFeed {
        try JSONDecoder().decode(VatsimFeed.self, from: data)
    }
}

public struct FeedGeneral: Codable, Sendable, Equatable {
    public var version: Int
    public var updateTimestamp: Date?
    public var connectedClients: Int
    public var uniqueUsers: Int

    public init(version: Int = 3, updateTimestamp: Date? = nil, connectedClients: Int = 0, uniqueUsers: Int = 0) {
        self.version = version
        self.updateTimestamp = updateTimestamp
        self.connectedClients = connectedClients
        self.uniqueUsers = uniqueUsers
    }

    enum CodingKeys: String, CodingKey {
        case version
        case updateTimestamp = "update_timestamp"
        case update // legacy "yyyyMMddHHmmss"
        case connectedClients = "connected_clients"
        case uniqueUsers = "unique_users"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version) ?? 3
        updateTimestamp = c.date(.updateTimestamp)
        connectedClients = c.int(.connectedClients) ?? 0
        uniqueUsers = c.int(.uniqueUsers) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encodeIfPresent(updateTimestamp.map(FastISO8601.string(from:)), forKey: .updateTimestamp)
        try c.encode(connectedClients, forKey: .connectedClients)
        try c.encode(uniqueUsers, forKey: .uniqueUsers)
    }
}

// MARK: - Pilot

public struct Pilot: Codable, Sendable, Hashable, Identifiable {
    public var cid: Int
    public var name: String
    public var callsign: String
    public var server: String
    public var pilotRating: Int
    public var militaryRating: Int
    public var latitude: Double
    public var longitude: Double
    /// Feet MSL (true altitude as reported by the pilot client).
    public var altitude: Int
    /// Knots.
    public var groundspeed: Int
    public var transponder: String
    /// Degrees true, 0–359.
    public var heading: Int
    public var qnhInHg: Double
    public var qnhMb: Int
    public var flightPlan: FlightPlan?
    public var logonTime: Date?
    public var lastUpdated: Date?

    /// Callsigns are unique on the network at any time; used as stable identity for diffs.
    public var id: String { callsign }
    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }

    public init(
        cid: Int, name: String = "", callsign: String, server: String = "", pilotRating: Int = 0,
        militaryRating: Int = 0, latitude: Double, longitude: Double, altitude: Int = 0, groundspeed: Int = 0,
        transponder: String = "2000", heading: Int = 0, qnhInHg: Double = 29.92, qnhMb: Int = 1013,
        flightPlan: FlightPlan? = nil, logonTime: Date? = nil, lastUpdated: Date? = nil
    ) {
        self.cid = cid
        self.name = name
        self.callsign = callsign
        self.server = server
        self.pilotRating = pilotRating
        self.militaryRating = militaryRating
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.groundspeed = groundspeed
        self.transponder = transponder
        self.heading = heading
        self.qnhInHg = qnhInHg
        self.qnhMb = qnhMb
        self.flightPlan = flightPlan
        self.logonTime = logonTime
        self.lastUpdated = lastUpdated
    }

    enum CodingKeys: String, CodingKey {
        case cid, name, callsign, server, latitude, longitude, altitude, groundspeed, transponder, heading
        case pilotRating = "pilot_rating"
        case militaryRating = "military_rating"
        case qnhInHg = "qnh_i_hg"
        case qnhMb = "qnh_mb"
        case flightPlan = "flight_plan"
        case logonTime = "logon_time"
        case lastUpdated = "last_updated"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // A pilot without a usable position cannot be shown; reject the record (LossyArray skips it).
        guard let lat = c.double(.latitude), let lon = c.double(.longitude),
              (-90...90).contains(lat), (-180...180).contains(lon)
        else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing position"))
        }
        cid = c.int(.cid) ?? 0
        name = c.string(.name)
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        server = c.string(.server)
        pilotRating = c.int(.pilotRating) ?? 0
        militaryRating = c.int(.militaryRating) ?? 0
        latitude = lat
        longitude = lon
        altitude = c.int(.altitude) ?? 0
        groundspeed = max(0, c.int(.groundspeed) ?? 0)
        transponder = c.string(.transponder, default: "2000")
        heading = ((c.int(.heading) ?? 0) % 360 + 360) % 360
        qnhInHg = c.double(.qnhInHg) ?? 29.92
        qnhMb = c.int(.qnhMb) ?? 1013
        flightPlan = c.lenient(FlightPlan.self, forKey: .flightPlan)
        logonTime = c.date(.logonTime)
        lastUpdated = c.date(.lastUpdated)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cid, forKey: .cid)
        try c.encode(name, forKey: .name)
        try c.encode(callsign, forKey: .callsign)
        try c.encode(server, forKey: .server)
        try c.encode(pilotRating, forKey: .pilotRating)
        try c.encode(militaryRating, forKey: .militaryRating)
        try c.encode(latitude, forKey: .latitude)
        try c.encode(longitude, forKey: .longitude)
        try c.encode(altitude, forKey: .altitude)
        try c.encode(groundspeed, forKey: .groundspeed)
        try c.encode(transponder, forKey: .transponder)
        try c.encode(heading, forKey: .heading)
        try c.encode(qnhInHg, forKey: .qnhInHg)
        try c.encode(qnhMb, forKey: .qnhMb)
        try c.encodeIfPresent(flightPlan, forKey: .flightPlan)
        try c.encodeIfPresent(logonTime.map(FastISO8601.string(from:)), forKey: .logonTime)
        try c.encodeIfPresent(lastUpdated.map(FastISO8601.string(from:)), forKey: .lastUpdated)
    }
}

// MARK: - Flight plan

public struct FlightPlan: Codable, Sendable, Hashable {
    /// "I" IFR, "V" VFR, "Y"/"Z" mixed.
    public var flightRules: String
    /// ICAO format, e.g. "B738/M-SDE2E3FGHIRWXY/LB1".
    public var aircraft: String
    public var aircraftFAA: String
    /// ICAO type designator only, e.g. "B738".
    public var aircraftShort: String
    public var departure: String
    public var arrival: String
    public var alternate: String
    /// Cruise true airspeed as filed ("450", "N0450", "M078").
    public var cruiseTAS: String
    /// Cruise altitude as filed ("35000", "FL350", "F350").
    public var altitude: String
    /// Departure time "HHmm" UTC.
    public var deptime: String
    /// En-route time "HHmm".
    public var enrouteTime: String
    public var fuelTime: String
    public var remarks: String
    public var route: String
    public var revisionID: Int
    public var assignedTransponder: String

    public init(
        flightRules: String = "I", aircraft: String = "", aircraftFAA: String = "", aircraftShort: String = "",
        departure: String = "", arrival: String = "", alternate: String = "", cruiseTAS: String = "",
        altitude: String = "", deptime: String = "", enrouteTime: String = "", fuelTime: String = "",
        remarks: String = "", route: String = "", revisionID: Int = 0, assignedTransponder: String = ""
    ) {
        self.flightRules = flightRules
        self.aircraft = aircraft
        self.aircraftFAA = aircraftFAA
        self.aircraftShort = aircraftShort
        self.departure = departure
        self.arrival = arrival
        self.alternate = alternate
        self.cruiseTAS = cruiseTAS
        self.altitude = altitude
        self.deptime = deptime
        self.enrouteTime = enrouteTime
        self.fuelTime = fuelTime
        self.remarks = remarks
        self.route = route
        self.revisionID = revisionID
        self.assignedTransponder = assignedTransponder
    }

    enum CodingKeys: String, CodingKey {
        case aircraft, departure, arrival, alternate, altitude, deptime, remarks, route
        case flightRules = "flight_rules"
        case aircraftFAA = "aircraft_faa"
        case aircraftShort = "aircraft_short"
        case cruiseTAS = "cruise_tas"
        case enrouteTime = "enroute_time"
        case fuelTime = "fuel_time"
        case revisionID = "revision_id"
        case assignedTransponder = "assigned_transponder"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        flightRules = c.string(.flightRules, default: "I")
        aircraft = c.string(.aircraft)
        aircraftFAA = c.string(.aircraftFAA)
        aircraftShort = c.string(.aircraftShort)
        departure = c.string(.departure).trimmingCharacters(in: .whitespaces).uppercased()
        arrival = c.string(.arrival).trimmingCharacters(in: .whitespaces).uppercased()
        alternate = c.string(.alternate).trimmingCharacters(in: .whitespaces).uppercased()
        cruiseTAS = c.string(.cruiseTAS)
        altitude = c.string(.altitude)
        deptime = c.string(.deptime)
        enrouteTime = c.string(.enrouteTime)
        fuelTime = c.string(.fuelTime)
        remarks = c.string(.remarks)
        route = c.string(.route)
        revisionID = c.int(.revisionID) ?? 0
        assignedTransponder = c.string(.assignedTransponder)
    }

    /// ICAO type designator, derived from `aircraftShort` or the full ICAO string.
    public var aircraftType: String {
        if !aircraftShort.isEmpty { return aircraftShort.uppercased() }
        let raw = aircraft.split(separator: "/").first.map(String.init) ?? aircraft
        return raw.uppercased()
    }

    /// Filed cruise altitude in feet, if parseable ("35000", "FL350", "F350", "S1130" metric ignored).
    public var cruiseAltitudeFeet: Int? {
        let s = altitude.uppercased().trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("FL"), let v = Int(s.dropFirst(2)) { return v * 100 }
        if s.hasPrefix("F"), let v = Int(s.dropFirst()) { return v * 100 }
        if s.hasPrefix("A"), let v = Int(s.dropFirst()) { return v * 100 }
        if let v = Int(s) { return v < 1000 ? v * 100 : v }
        return nil
    }

    /// Filed cruise true airspeed in knots ("450", "N0450", "M078" → ≈ Mach × 573 kt at cruise).
    public var cruiseSpeedKnots: Int? {
        let s = cruiseTAS.uppercased().trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("N"), let v = Int(s.dropFirst()) { return v }
        if s.hasPrefix("K"), let v = Int(s.dropFirst()) { return Int(Double(v) / 1.852) }
        if s.hasPrefix("M"), let v = Int(s.dropFirst()) { return Int(Double(v) / 100 * 573) }
        if let v = Int(s), v > 0 { return v }
        return nil
    }

    /// Filed en-route time in seconds ("0130" → 5400).
    public var enrouteDuration: TimeInterval? { Self.hhmmToSeconds(enrouteTime) }

    /// Filed fuel endurance in seconds.
    public var fuelDuration: TimeInterval? { Self.hhmmToSeconds(fuelTime) }

    static func hhmmToSeconds(_ s: String) -> TimeInterval? {
        let digits = s.filter(\.isNumber)
        guard !digits.isEmpty, let v = Int(digits) else { return nil }
        let hours = v / 100, minutes = v % 100
        guard minutes < 60 else { return nil }
        let total = TimeInterval(hours * 3600 + minutes * 60)
        return total > 0 ? total : nil
    }

    /// Filed departure time on the UTC day closest to `reference` (handles midnight wrap).
    public func departureDate(relativeTo reference: Date) -> Date? {
        let digits = deptime.filter(\.isNumber)
        guard digits.count >= 3, let v = Int(digits) else { return nil }
        let h = v / 100, m = v % 100
        guard h < 24, m < 60 else { return nil }
        let dayStart = (reference.timeIntervalSince1970 / 86_400).rounded(.down) * 86_400
        var candidate = dayStart + Double(h * 3600 + m * 60)
        let ref = reference.timeIntervalSince1970
        if candidate - ref > 12 * 3600 { candidate -= 86_400 }
        if ref - candidate > 12 * 3600 { candidate += 86_400 }
        return Date(timeIntervalSince1970: candidate)
    }

    public var isVFR: Bool { flightRules.uppercased() == "V" }
}

// MARK: - Controller / ATIS

public struct Controller: Codable, Sendable, Hashable, Identifiable {
    public var cid: Int
    public var name: String
    public var callsign: String
    /// MHz as string, e.g. "118.700". "199.998" means not on frequency.
    public var frequency: String
    public var facility: Facility
    public var rating: Int
    public var server: String
    /// Nautical miles.
    public var visualRange: Int
    /// ATIS letter (ATIS stations only).
    public var atisCode: String?
    public var textAtis: [String]
    public var lastUpdated: Date?
    public var logonTime: Date?

    public var id: String { callsign }

    public init(
        cid: Int, name: String = "", callsign: String, frequency: String = "199.998", facility: Facility,
        rating: Int = 1, server: String = "", visualRange: Int = 0, atisCode: String? = nil,
        textAtis: [String] = [], lastUpdated: Date? = nil, logonTime: Date? = nil
    ) {
        self.cid = cid
        self.name = name
        self.callsign = callsign
        self.frequency = frequency
        self.facility = facility
        self.rating = rating
        self.server = server
        self.visualRange = visualRange
        self.atisCode = atisCode
        self.textAtis = textAtis
        self.lastUpdated = lastUpdated
        self.logonTime = logonTime
    }

    enum CodingKeys: String, CodingKey {
        case cid, name, callsign, frequency, facility, rating, server
        case visualRange = "visual_range"
        case atisCode = "atis_code"
        case textAtis = "text_atis"
        case lastUpdated = "last_updated"
        case logonTime = "logon_time"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cid = c.int(.cid) ?? 0
        name = c.string(.name)
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        frequency = c.string(.frequency, default: "199.998")
        let facilityID = c.int(.facility) ?? 0
        facility = Facility(rawValue: facilityID) ?? .observer
        rating = c.int(.rating) ?? 1
        server = c.string(.server)
        visualRange = c.int(.visualRange) ?? 0
        atisCode = c.optionalString(.atisCode)
        textAtis = (c.lenient([String?].self, forKey: .textAtis) ?? []).compactMap { $0 }
        lastUpdated = c.date(.lastUpdated)
        logonTime = c.date(.logonTime)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cid, forKey: .cid)
        try c.encode(name, forKey: .name)
        try c.encode(callsign, forKey: .callsign)
        try c.encode(frequency, forKey: .frequency)
        try c.encode(facility.rawValue, forKey: .facility)
        try c.encode(rating, forKey: .rating)
        try c.encode(server, forKey: .server)
        try c.encode(visualRange, forKey: .visualRange)
        try c.encodeIfPresent(atisCode, forKey: .atisCode)
        try c.encode(textAtis, forKey: .textAtis)
        try c.encodeIfPresent(lastUpdated.map(FastISO8601.string(from:)), forKey: .lastUpdated)
        try c.encodeIfPresent(logonTime.map(FastISO8601.string(from:)), forKey: .logonTime)
    }

    /// True when the controller is on a real frequency (not observing / "199.998").
    public var isOnFrequency: Bool {
        guard let mhz = Double(frequency) else { return false }
        return mhz >= 118.0 && mhz < 137.0 && frequency != "199.998"
    }

    /// Callsign components, e.g. "LIRF_N_APP" → prefix "LIRF", middle ["N"], suffix "APP".
    public var callsignParts: (prefix: String, middle: [String], suffix: String) {
        let parts = callsign.split(separator: "_").map(String.init)
        guard let first = parts.first else { return ("", [], "") }
        guard parts.count > 1 else { return (first, [], "") }
        return (first, Array(parts.dropFirst().dropLast()), parts.last ?? "")
    }

    /// Kind of position, derived from the callsign suffix (more reliable than `facility`).
    public var position: ATCPosition { ATCPosition(callsign: callsign, facility: facility) }

    /// ATIS text joined into a single paragraph.
    public var atisText: String { textAtis.joined(separator: " ") }
}

/// Facility type as reported by the network.
public enum Facility: Int, Codable, Sendable, Hashable, CaseIterable {
    case observer = 0, flightService = 1, delivery = 2, ground = 3, tower = 4, approach = 5, center = 6
}

/// Logical ATC position, derived from the callsign suffix.
public enum ATCPosition: String, Codable, Sendable, Hashable, CaseIterable, Comparable {
    case atis = "ATIS", delivery = "DEL", ground = "GND", tower = "TWR", approach = "APP", departure = "DEP"
    case center = "CTR", flightService = "FSS", observer = "OBS", supervisor = "SUP"

    public init(callsign: String, facility: Facility) {
        let suffix = callsign.split(separator: "_").last.map { String($0).uppercased() } ?? ""
        switch suffix {
        case "ATIS": self = .atis
        case "DEL": self = .delivery
        case "GND", "RMP": self = .ground
        case "TWR": self = .tower
        case "APP": self = .approach
        case "DEP": self = .departure
        case "CTR": self = .center
        case "FSS": self = .flightService
        case "SUP": self = .supervisor
        case "OBS": self = .observer
        default:
            switch facility {
            case .delivery: self = .delivery
            case .ground: self = .ground
            case .tower: self = .tower
            case .approach: self = .approach
            case .center: self = .center
            case .flightService: self = .flightService
            case .observer: self = .observer
            }
        }
    }

    /// Ordering from smallest to largest airspace.
    public var rank: Int {
        switch self {
        case .atis: 0
        case .delivery: 1
        case .ground: 2
        case .tower: 3
        case .approach, .departure: 4
        case .center: 5
        case .flightService: 6
        case .observer, .supervisor: 7
        }
    }

    public static func < (lhs: ATCPosition, rhs: ATCPosition) -> Bool { lhs.rank < rhs.rank }

    /// Positions shown on an airport (local) rather than as area sectors.
    public var isAirportLocal: Bool { [.atis, .delivery, .ground, .tower].contains(self) }
}

// MARK: - Misc

public struct Server: Codable, Sendable, Hashable {
    public var ident: String
    public var hostnameOrIP: String
    public var location: String
    public var name: String
    public var clientConnectionsAllowed: Bool
    public var isSweatbox: Bool

    enum CodingKeys: String, CodingKey {
        case ident, location, name
        case hostnameOrIP = "hostname_or_ip"
        case clientConnectionsAllowed = "client_connections_allowed"
        case isSweatbox = "is_sweatbox"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ident = c.string(.ident)
        hostnameOrIP = c.string(.hostnameOrIP)
        location = c.string(.location)
        name = c.string(.name)
        clientConnectionsAllowed = c.bool(.clientConnectionsAllowed) ?? true
        isSweatbox = c.bool(.isSweatbox) ?? false
    }
}

public struct Prefile: Codable, Sendable, Hashable, Identifiable {
    public var cid: Int
    public var name: String
    public var callsign: String
    public var flightPlan: FlightPlan?
    public var lastUpdated: Date?

    public var id: String { callsign }

    public init(cid: Int, name: String = "", callsign: String, flightPlan: FlightPlan?, lastUpdated: Date? = nil) {
        self.cid = cid
        self.name = name
        self.callsign = callsign
        self.flightPlan = flightPlan
        self.lastUpdated = lastUpdated
    }

    enum CodingKeys: String, CodingKey {
        case cid, name, callsign
        case flightPlan = "flight_plan"
        case lastUpdated = "last_updated"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cid = c.int(.cid) ?? 0
        name = c.string(.name)
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        flightPlan = c.lenient(FlightPlan.self, forKey: .flightPlan)
        lastUpdated = c.date(.lastUpdated)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cid, forKey: .cid)
        try c.encode(name, forKey: .name)
        try c.encode(callsign, forKey: .callsign)
        try c.encodeIfPresent(flightPlan, forKey: .flightPlan)
        try c.encodeIfPresent(lastUpdated.map(FastISO8601.string(from:)), forKey: .lastUpdated)
    }
}

/// `facilities`, `ratings`, `pilot_ratings`, `military_ratings` reference tables.
public struct ReferenceEntry: Codable, Sendable, Hashable {
    public var id: Int
    public var short: String
    public var long: String

    enum CodingKeys: String, CodingKey {
        case id, short, long
        case shortName = "short_name"
        case longName = "long_name"
    }

    public init(id: Int, short: String, long: String) {
        self.id = id
        self.short = short
        self.long = long
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.int(.id) ?? 0
        short = c.optionalString(.short) ?? c.string(.shortName)
        long = c.optionalString(.long) ?? c.string(.longName)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(short, forKey: .short)
        try c.encode(long, forKey: .long)
    }
}

/// Controller ratings (network `rating` field).
public enum ControllerRating: Int, Sendable, CaseIterable {
    case inactive = -1, suspended = 0, observer = 1, s1 = 2, s2 = 3, s3 = 4, c1 = 5, c2 = 6, c3 = 7
    case i1 = 8, i2 = 9, i3 = 10, supervisor = 11, administrator = 12

    public var shortName: String {
        switch self {
        case .inactive: "INAC"
        case .suspended: "SUS"
        case .observer: "OBS"
        case .s1: "S1"
        case .s2: "S2"
        case .s3: "S3"
        case .c1: "C1"
        case .c2: "C2"
        case .c3: "C3"
        case .i1: "I1"
        case .i2: "I2"
        case .i3: "I3"
        case .supervisor: "SUP"
        case .administrator: "ADM"
        }
    }

    public static func shortName(for raw: Int) -> String { ControllerRating(rawValue: raw)?.shortName ?? "—" }
}
