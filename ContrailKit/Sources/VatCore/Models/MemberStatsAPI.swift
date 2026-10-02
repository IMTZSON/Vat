import Foundation

// VATSIM member API (public, anonymous):
//   GET https://api.vatsim.net/v2/members/{cid}/stats
//   GET https://api.vatsim.net/v2/members/{cid}
//   GET https://api.vatsim.net/v2/members/{cid}/flightplans

/// Hours logged by a member, overall and per controller rating.
public struct MemberStats: Codable, Sendable, Hashable {
    public var cid: Int
    /// Total controlling hours.
    public var atc: Double
    /// Total piloting hours.
    public var pilot: Double
    public var s1: Double
    public var s2: Double
    public var s3: Double
    public var c1: Double
    public var c2: Double
    public var c3: Double
    public var i1: Double
    public var i2: Double
    public var i3: Double
    public var sup: Double
    public var adm: Double

    public init(cid: Int, atc: Double = 0, pilot: Double = 0, s1: Double = 0, s2: Double = 0, s3: Double = 0,
                c1: Double = 0, c2: Double = 0, c3: Double = 0, i1: Double = 0, i2: Double = 0, i3: Double = 0,
                sup: Double = 0, adm: Double = 0) {
        self.cid = cid
        self.atc = atc
        self.pilot = pilot
        self.s1 = s1
        self.s2 = s2
        self.s3 = s3
        self.c1 = c1
        self.c2 = c2
        self.c3 = c3
        self.i1 = i1
        self.i2 = i2
        self.i3 = i3
        self.sup = sup
        self.adm = adm
    }

    enum CodingKeys: String, CodingKey {
        case id, cid, atc, pilot, s1, s2, s3, c1, c2, c3, i1, i2, i3, sup, adm
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cid = c.int(.id) ?? c.int(.cid) ?? 0
        atc = c.double(.atc) ?? 0
        pilot = c.double(.pilot) ?? 0
        s1 = c.double(.s1) ?? 0
        s2 = c.double(.s2) ?? 0
        s3 = c.double(.s3) ?? 0
        c1 = c.double(.c1) ?? 0
        c2 = c.double(.c2) ?? 0
        c3 = c.double(.c3) ?? 0
        i1 = c.double(.i1) ?? 0
        i2 = c.double(.i2) ?? 0
        i3 = c.double(.i3) ?? 0
        sup = c.double(.sup) ?? 0
        adm = c.double(.adm) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cid, forKey: .id)
        for (key, value) in [(CodingKeys.atc, atc), (.pilot, pilot), (.s1, s1), (.s2, s2), (.s3, s3), (.c1, c1),
                             (.c2, c2), (.c3, c3), (.i1, i1), (.i2, i2), (.i3, i3), (.sup, sup), (.adm, adm)] {
            try c.encode(value, forKey: key)
        }
    }

    /// Total hours on the network.
    public var totalHours: Double { atc + pilot }

    /// Controlling hours per rating, in rating order, omitting zero entries.
    public var atcHoursByRating: [(rating: String, hours: Double)] {
        [("S1", s1), ("S2", s2), ("S3", s3), ("C1", c1), ("C2", c2), ("C3", c3), ("I1", i1), ("I2", i2),
         ("I3", i3), ("SUP", sup), ("ADM", adm)].filter { $0.1 > 0 }.map { (rating: $0.0, hours: $0.1) }
    }
}

/// Public member details.
public struct MemberInfo: Codable, Sendable, Hashable {
    public var cid: Int
    /// Controller rating (see ``ControllerRating``).
    public var rating: Int
    /// Pilot rating bitmask/id as returned by the API.
    public var pilotRating: Int
    public var militaryRating: Int
    public var regionID: String
    public var divisionID: String
    public var subdivisionID: String
    public var registeredAt: Date?

    public init(cid: Int, rating: Int = 1, pilotRating: Int = 0, militaryRating: Int = 0, regionID: String = "",
                divisionID: String = "", subdivisionID: String = "", registeredAt: Date? = nil) {
        self.cid = cid
        self.rating = rating
        self.pilotRating = pilotRating
        self.militaryRating = militaryRating
        self.regionID = regionID
        self.divisionID = divisionID
        self.subdivisionID = subdivisionID
        self.registeredAt = registeredAt
    }

    enum CodingKeys: String, CodingKey {
        case id, cid, rating
        case pilotRating = "pilotrating"
        case pilotRatingAlt = "pilot_rating"
        case militaryRating = "militaryrating"
        case militaryRatingAlt = "military_rating"
        case regionID = "region_id"
        case divisionID = "division_id"
        case subdivisionID = "subdivision_id"
        case registeredAt = "reg_date"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let cid = c.int(.id) ?? c.int(.cid) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing id"))
        }
        self.cid = cid
        rating = c.int(.rating) ?? 1
        pilotRating = c.int(.pilotRating) ?? c.int(.pilotRatingAlt) ?? 0
        militaryRating = c.int(.militaryRating) ?? c.int(.militaryRatingAlt) ?? 0
        regionID = c.string(.regionID)
        divisionID = c.string(.divisionID)
        subdivisionID = c.string(.subdivisionID)
        registeredAt = c.date(.registeredAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cid, forKey: .id)
        try c.encode(rating, forKey: .rating)
        try c.encode(pilotRating, forKey: .pilotRating)
        try c.encode(militaryRating, forKey: .militaryRating)
        try c.encode(regionID, forKey: .regionID)
        try c.encode(divisionID, forKey: .divisionID)
        try c.encode(subdivisionID, forKey: .subdivisionID)
        try c.encodeIfPresent(registeredAt.map(FastISO8601.string(from:)), forKey: .registeredAt)
    }

    /// Short controller rating name ("S2").
    public var ratingShortName: String { ControllerRating.shortName(for: rating) }
}

/// A flight plan from the member history endpoint (decoded tolerantly: field names vary).
public struct MemberFlightPlan: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    public var callsign: String
    public var departure: String
    public var arrival: String
    /// Aircraft as filed (ICAO or FAA format).
    public var aircraft: String
    public var route: String
    public var altitude: String
    public var flightRules: String
    public var filedAt: Date?

    public init(id: Int, callsign: String, departure: String, arrival: String, aircraft: String = "",
                route: String = "", altitude: String = "", flightRules: String = "I", filedAt: Date? = nil) {
        self.id = id
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.aircraft = aircraft
        self.route = route
        self.altitude = altitude
        self.flightRules = flightRules
        self.filedAt = filedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, callsign, dep, departure, arr, arrival, aircraft, route, alt, altitude, filed, flightType = "flight_type"
        case createdAt = "created_at"
        case flightRules = "flight_rules"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        departure = (c.optionalString(.dep) ?? c.string(.departure)).trimmingCharacters(in: .whitespaces).uppercased()
        arrival = (c.optionalString(.arr) ?? c.string(.arrival)).trimmingCharacters(in: .whitespaces).uppercased()
        guard !callsign.isEmpty || !departure.isEmpty || !arrival.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Empty plan"))
        }
        aircraft = c.string(.aircraft)
        route = c.string(.route)
        altitude = c.optionalString(.altitude) ?? c.string(.alt)
        flightRules = c.optionalString(.flightType) ?? c.string(.flightRules, default: "I")
        filedAt = c.date(.filed) ?? c.date(.createdAt)
        id = c.int(.id) ?? Int(filedAt?.timeIntervalSince1970 ?? 0)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(callsign, forKey: .callsign)
        try c.encode(departure, forKey: .departure)
        try c.encode(arrival, forKey: .arrival)
        try c.encode(aircraft, forKey: .aircraft)
        try c.encode(route, forKey: .route)
        try c.encode(altitude, forKey: .altitude)
        try c.encode(flightRules, forKey: .flightRules)
        try c.encodeIfPresent(filedAt.map(FastISO8601.string(from:)), forKey: .filed)
    }

    /// ICAO type designator ("B738" from "B738/M-SDE2" or "H/B744/L").
    public var aircraftType: String {
        let parts = aircraft.uppercased().split(separator: "/").map(String.init)
        if parts.count >= 2, parts[0].count == 1 { return parts[1] }
        return parts.first ?? ""
    }

    /// Decodes either a bare array or an object wrapping it (`items`, `data`, `results`).
    public static func decodeList(_ data: Data) throws -> [MemberFlightPlan] {
        struct Wrapper: Decodable {
            var plans: [MemberFlightPlan]
            enum Keys: String, CodingKey { case items, data, results, flightplans }
            init(from decoder: Decoder) throws {
                if let c = try? decoder.container(keyedBy: Keys.self) {
                    for key in [Keys.items, .data, .results, .flightplans] where c.contains(key) {
                        plans = c.lossyArray(MemberFlightPlan.self, forKey: key)
                        return
                    }
                    plans = []
                } else {
                    plans = try LossyArray<MemberFlightPlan>(from: decoder).elements
                }
            }
        }
        return try JSONDecoder().decode(Wrapper.self, from: data).plans
    }
}
