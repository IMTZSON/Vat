import Foundation

// SimBrief latest OFP, JSON v2: https://www.simbrief.com/api/xml.fetcher.php?username={u}&json=v2
// The JSON is converted from XML: every scalar is a string, empty values may be `{}`, and lists
// with a single element collapse to an object. Everything here is decoded leniently.

/// Errors specific to SimBrief.
public enum SimBriefError: Error, Sendable, Equatable, LocalizedError {
    /// HTTP 400 / "Unknown UserID": wrong username or user ID.
    case userNotFound
    /// SimBrief answered with an error status (e.g. no flight plan generated yet).
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .userNotFound: "SimBrief user not found. Check your username or Pilot ID."
        case let .server(message): "SimBrief returned an error: \(message)"
        }
    }
}

/// Decodes either a single object or an array of objects.
struct OneOrMany<Element: Decodable>: Decodable {
    var elements: [Element]

    init(from decoder: Decoder) throws {
        if let list = try? LossyArray<Element>(from: decoder) {
            elements = list.elements
        } else if let single = try? Element(from: decoder) {
            elements = [single]
        } else {
            elements = []
        }
    }
}

/// An airport block of the OFP (origin, destination, alternate).
public struct SimBriefAirport: Codable, Sendable, Hashable {
    public var icao: String
    public var iata: String
    public var name: String
    public var latitude: Double
    public var longitude: Double
    /// Planned runway ("25", "16L"), may be empty.
    public var runway: String
    public var elevationFt: Int

    public init(icao: String, iata: String = "", name: String = "", latitude: Double, longitude: Double,
                runway: String = "", elevationFt: Int = 0) {
        self.icao = icao
        self.iata = iata
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.runway = runway
        self.elevationFt = elevationFt
    }

    enum CodingKeys: String, CodingKey {
        case icao = "icao_code"
        case iata = "iata_code"
        case name
        case latitude = "pos_lat"
        case longitude = "pos_long"
        case runway = "plan_rwy"
        case elevationFt = "elevation"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        icao = c.string(.icao).uppercased()
        guard !icao.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing ICAO"))
        }
        iata = c.string(.iata).uppercased()
        name = c.string(.name)
        latitude = c.double(.latitude) ?? 0
        longitude = c.double(.longitude) ?? 0
        runway = c.string(.runway)
        elevationFt = c.int(.elevationFt) ?? 0
    }

    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }
}

/// One navigation log entry.
public struct SimBriefFix: Codable, Sendable, Hashable {
    public var ident: String
    public var name: String
    /// "wpt", "vor", "ndb", "apt", "ltlg" (lat/lon), "toc", "tod"…
    public var type: String
    public var latitude: Double
    public var longitude: Double
    public var altitudeFt: Int?
    /// Airway or procedure used to reach the fix ("UM728", "DCT", "RAVA5A").
    public var viaAirway: String
    /// Elapsed time from takeoff, seconds.
    public var timeTotal: TimeInterval?

    public init(ident: String, name: String = "", type: String = "wpt", latitude: Double, longitude: Double,
                altitudeFt: Int? = nil, viaAirway: String = "", timeTotal: TimeInterval? = nil) {
        self.ident = ident
        self.name = name
        self.type = type
        self.latitude = latitude
        self.longitude = longitude
        self.altitudeFt = altitudeFt
        self.viaAirway = viaAirway
        self.timeTotal = timeTotal
    }

    enum CodingKeys: String, CodingKey {
        case ident, name, type
        case latitude = "pos_lat"
        case longitude = "pos_long"
        case altitudeFt = "altitude_feet"
        case viaAirway = "via_airway"
        case timeTotal = "time_total"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let lat = c.double(.latitude), let lon = c.double(.longitude),
              (-90...90).contains(lat), (-180...180).contains(lon) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing position"))
        }
        ident = c.string(.ident).uppercased()
        name = c.string(.name)
        type = c.string(.type)
        latitude = lat
        longitude = lon
        altitudeFt = c.int(.altitudeFt)
        viaAirway = c.string(.viaAirway)
        timeTotal = c.double(.timeTotal)
    }

    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }

    /// True for pseudo fixes inserted by SimBrief (top of climb/descent).
    public var isPseudo: Bool { ["TOC", "TOD"].contains(ident) || type.lowercased() == "toc" || type.lowercased() == "tod" }
}

/// The parts of a SimBrief OFP that Contrail uses.
public struct SimBriefOFP: Decodable, Sendable, Hashable {
    /// SimBrief request ID (unique per generated OFP).
    public var ofpID: String
    public var generatedAt: Date?
    public var airac: String
    public var origin: SimBriefAirport?
    public var destination: SimBriefAirport?
    /// First alternate.
    public var alternate: SimBriefAirport?
    /// ATC callsign (`atc.callsign`), e.g. "AZA123".
    public var callsign: String
    /// ICAO type ("A320").
    public var aircraftType: String
    public var aircraftRegistration: String
    /// Route string (`general.route`).
    public var route: String
    public var initialAltitudeFt: Int?
    public var cruiseTAS: Int?
    public var costIndex: String
    public var scheduledOut: Date?
    public var scheduledOff: Date?
    public var scheduledOn: Date?
    public var scheduledIn: Date?
    /// Estimated en-route time (seconds).
    public var estimatedTimeEnroute: TimeInterval?
    public var navlog: [SimBriefFix]

    public init(ofpID: String = "", generatedAt: Date? = nil, airac: String = "", origin: SimBriefAirport? = nil,
                destination: SimBriefAirport? = nil, alternate: SimBriefAirport? = nil, callsign: String = "",
                aircraftType: String = "", aircraftRegistration: String = "", route: String = "",
                initialAltitudeFt: Int? = nil, cruiseTAS: Int? = nil, costIndex: String = "",
                scheduledOut: Date? = nil, scheduledOff: Date? = nil, scheduledOn: Date? = nil, scheduledIn: Date? = nil,
                estimatedTimeEnroute: TimeInterval? = nil, navlog: [SimBriefFix] = []) {
        self.ofpID = ofpID
        self.generatedAt = generatedAt
        self.airac = airac
        self.origin = origin
        self.destination = destination
        self.alternate = alternate
        self.callsign = callsign
        self.aircraftType = aircraftType
        self.aircraftRegistration = aircraftRegistration
        self.route = route
        self.initialAltitudeFt = initialAltitudeFt
        self.cruiseTAS = cruiseTAS
        self.costIndex = costIndex
        self.scheduledOut = scheduledOut
        self.scheduledOff = scheduledOff
        self.scheduledOn = scheduledOn
        self.scheduledIn = scheduledIn
        self.estimatedTimeEnroute = estimatedTimeEnroute
        self.navlog = navlog
    }

    private enum RootKeys: String, CodingKey {
        case fetch, params, general, origin, destination, alternate, navlog, atc, aircraft, times
    }
    private enum FetchKeys: String, CodingKey { case status }
    private enum ParamsKeys: String, CodingKey { case requestID = "request_id", timeGenerated = "time_generated", airac }
    private enum GeneralKeys: String, CodingKey {
        case route, initialAltitude = "initial_altitude", cruiseTAS = "cruise_tas", costIndex = "costindex"
        case airline = "icao_airline", flightNumber = "flight_number"
    }
    private enum NavlogKeys: String, CodingKey { case fix }
    private enum ATCKeys: String, CodingKey { case callsign }
    private enum AircraftKeys: String, CodingKey { case icaocode, icaoCode = "icao_code", reg }
    private enum TimesKeys: String, CodingKey {
        case schedOut = "sched_out", schedOff = "sched_off", schedOn = "sched_on", schedIn = "sched_in"
        case enroute = "est_time_enroute"
    }

    public init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        if let fetch = try? root.nestedContainer(keyedBy: FetchKeys.self, forKey: .fetch) {
            let status = fetch.string(.status)
            if !status.isEmpty, status.lowercased() != "success" {
                if status.lowercased().contains("unknown") { throw SimBriefError.userNotFound }
                throw SimBriefError.server(status)
            }
        }
        let params = try? root.nestedContainer(keyedBy: ParamsKeys.self, forKey: .params)
        ofpID = params?.string(.requestID) ?? ""
        generatedAt = params?.double(.timeGenerated).map { Date(timeIntervalSince1970: $0) }
        airac = params?.string(.airac) ?? ""

        origin = root.lenient(SimBriefAirport.self, forKey: .origin)
        destination = root.lenient(SimBriefAirport.self, forKey: .destination)
        alternate = root.lenient(OneOrMany<SimBriefAirport>.self, forKey: .alternate)?.elements.first

        let general = try? root.nestedContainer(keyedBy: GeneralKeys.self, forKey: .general)
        route = general?.string(.route) ?? ""
        initialAltitudeFt = general?.int(.initialAltitude)
        cruiseTAS = general?.int(.cruiseTAS)
        costIndex = general?.string(.costIndex) ?? ""

        let atc = try? root.nestedContainer(keyedBy: ATCKeys.self, forKey: .atc)
        var callsign = atc?.string(.callsign).uppercased() ?? ""
        if callsign.isEmpty, let general {
            callsign = (general.string(.airline) + general.string(.flightNumber)).uppercased()
        }
        self.callsign = callsign

        let aircraft = try? root.nestedContainer(keyedBy: AircraftKeys.self, forKey: .aircraft)
        aircraftType = (aircraft?.optionalString(.icaocode) ?? aircraft?.string(.icaoCode) ?? "").uppercased()
        aircraftRegistration = aircraft?.string(.reg) ?? ""

        let times = try? root.nestedContainer(keyedBy: TimesKeys.self, forKey: .times)
        func date(_ key: TimesKeys) -> Date? {
            guard let seconds = times?.double(key), seconds > 0 else { return nil }
            return Date(timeIntervalSince1970: seconds)
        }
        scheduledOut = date(.schedOut)
        scheduledOff = date(.schedOff)
        scheduledOn = date(.schedOn)
        scheduledIn = date(.schedIn)
        estimatedTimeEnroute = times?.double(.enroute)

        let navlogContainer = try? root.nestedContainer(keyedBy: NavlogKeys.self, forKey: .navlog)
        navlog = navlogContainer?.lenient(OneOrMany<SimBriefFix>.self, forKey: .fix)?.elements ?? []
    }

    /// Decodes a JSON v2 payload.
    public static func decode(_ data: Data) throws -> SimBriefOFP {
        do {
            return try JSONDecoder().decode(SimBriefOFP.self, from: data)
        } catch let error as SimBriefError {
            throw error
        } catch {
            throw NetworkError.decoding("SimBrief OFP: \(error)")
        }
    }

    /// Route points (origin, navlog fixes without TOC/TOD, destination) for drawing and ETA.
    public var waypoints: [Waypoint] {
        var result: [Waypoint] = []
        if let origin {
            result.append(Waypoint(ident: origin.icao, name: origin.name, kind: .airport, point: origin.position))
        }
        for fix in navlog where !fix.isPseudo {
            if fix.type.lowercased() == "apt", fix.ident == origin?.icao || fix.ident == destination?.icao { continue }
            let kind: Waypoint.Kind = switch fix.type.lowercased() {
            case "vor", "ndb", "dme", "vordme", "vortac", "tacan": .navaid
            case "apt": .airport
            case "ltlg": .coordinate
            default: .fix
            }
            result.append(Waypoint(ident: fix.ident, name: fix.name, kind: kind, point: fix.position,
                                   plannedAltitudeFt: fix.altitudeFt, via: fix.viaAirway.isEmpty ? nil : fix.viaAirway))
        }
        if let destination {
            result.append(Waypoint(ident: destination.icao, name: destination.name, kind: .airport, point: destination.position))
        }
        return result
    }

    /// A lookup resolving the OFP's own fixes (coordinates included), to combine with the
    /// airport/navaid databases when parsing the route string (DECISIONS D-014).
    public var waypointLookup: StaticWaypointLookup { StaticWaypointLookup(waypoints: waypoints) }
}
