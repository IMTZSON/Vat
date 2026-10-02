import Foundation

// ATC bookings: GET https://atc-bookings.vatsim.net/api/booking
// Events:       GET https://my.vatsim.net/api/v2/events/latest  → { "data": [VatsimEvent] }

public struct ATCBooking: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable, Hashable, CaseIterable {
        case booking, event, exam, training
    }

    public var id: Int
    public var cid: Int
    public var callsign: String
    public var kind: Kind
    public var start: Date
    public var end: Date
    public var division: String
    public var subdivision: String

    public init(id: Int, cid: Int = 0, callsign: String, kind: Kind = .booking, start: Date, end: Date,
                division: String = "", subdivision: String = "") {
        self.id = id
        self.cid = cid
        self.callsign = callsign
        self.kind = kind
        self.start = start
        self.end = end
        self.division = division
        self.subdivision = subdivision
    }

    enum CodingKeys: String, CodingKey {
        case id, cid, callsign, type, start, end, division, subdivision
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let start = c.date(.start), let end = c.date(.end) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing times"))
        }
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        guard !callsign.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing callsign"))
        }
        id = c.int(.id) ?? abs(callsign.hashValue ^ Int(start.timeIntervalSince1970))
        cid = c.int(.cid) ?? 0
        kind = Kind(rawValue: c.string(.type).lowercased()) ?? .booking
        self.start = start
        self.end = end
        division = c.string(.division)
        subdivision = c.string(.subdivision)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(cid, forKey: .cid)
        try c.encode(callsign, forKey: .callsign)
        try c.encode(kind.rawValue, forKey: .type)
        try c.encode(FastISO8601.string(from: start), forKey: .start)
        try c.encode(FastISO8601.string(from: end), forKey: .end)
        try c.encode(division, forKey: .division)
        try c.encode(subdivision, forKey: .subdivision)
    }

    public var position: ATCPosition { ATCPosition(callsign: callsign, facility: .observer) }

    /// ICAO / prefix part of the callsign ("LIRF" for "LIRF_TWR").
    public var prefix: String { String(callsign.split(separator: "_").first ?? "") }

    public func isActive(at date: Date) -> Bool { start <= date && date < end }

    public func overlaps(_ interval: DateInterval) -> Bool { start < interval.end && end > interval.start }
}

public struct VatsimEvent: Codable, Sendable, Hashable, Identifiable {
    public struct Organiser: Codable, Sendable, Hashable {
        public var region: String
        public var division: String
        public var subdivision: String
        public var organisedByVatsim: Bool

        public init(region: String = "", division: String = "", subdivision: String = "", organisedByVatsim: Bool = false) {
            self.region = region
            self.division = division
            self.subdivision = subdivision
            self.organisedByVatsim = organisedByVatsim
        }

        enum CodingKeys: String, CodingKey {
            case region, division, subdivision
            case organisedByVatsim = "organised_by_vatsim"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            region = c.string(.region)
            division = c.string(.division)
            subdivision = c.string(.subdivision)
            organisedByVatsim = c.bool(.organisedByVatsim) ?? false
        }
    }

    public struct Route: Codable, Sendable, Hashable {
        public var departure: String
        public var arrival: String
        public var route: String

        public init(departure: String, arrival: String, route: String = "") {
            self.departure = departure
            self.arrival = arrival
            self.route = route
        }

        enum CodingKeys: String, CodingKey { case departure, arrival, route }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            departure = c.string(.departure).uppercased()
            arrival = c.string(.arrival).uppercased()
            route = c.string(.route)
        }
    }

    public var id: Int
    /// "Event", "Controller Examination", "VASOPS Event".
    public var type: String
    public var name: String
    public var link: URL?
    public var organisers: [Organiser]
    /// ICAO codes.
    public var airports: [String]
    public var routes: [Route]
    public var start: Date
    public var end: Date
    public var shortDescription: String
    public var description: String
    public var bannerURL: URL?

    public init(
        id: Int, type: String = "Event", name: String, link: URL? = nil, organisers: [Organiser] = [],
        airports: [String] = [], routes: [Route] = [], start: Date, end: Date, shortDescription: String = "",
        description: String = "", bannerURL: URL? = nil
    ) {
        self.id = id
        self.type = type
        self.name = name
        self.link = link
        self.organisers = organisers
        self.airports = airports
        self.routes = routes
        self.start = start
        self.end = end
        self.shortDescription = shortDescription
        self.description = description
        self.bannerURL = bannerURL
    }

    enum CodingKeys: String, CodingKey {
        case id, type, name, link, organisers, airports, routes, description, banner
        case start = "start_time"
        case end = "end_time"
        case shortDescription = "short_description"
    }

    private struct AirportRef: Decodable {
        var icao: String
        init(from decoder: Decoder) throws {
            if let single = try? decoder.singleValueContainer(), let s = try? single.decode(String.self) {
                icao = s.uppercased()
                return
            }
            let c = try decoder.container(keyedBy: AnyCodingKey.self)
            icao = c.string(AnyCodingKey("icao")).uppercased()
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let start = c.date(.start) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing start"))
        }
        id = c.int(.id) ?? 0
        type = c.string(.type, default: "Event")
        name = c.string(.name)
        link = c.optionalString(.link).flatMap(URL.init(string:))
        organisers = c.lossyArray(Organiser.self, forKey: .organisers)
        airports = c.lossyArray(AirportRef.self, forKey: .airports).map(\.icao).filter { !$0.isEmpty }
        routes = c.lossyArray(Route.self, forKey: .routes)
        self.start = start
        end = c.date(.end) ?? start.addingTimeInterval(3 * 3600)
        shortDescription = c.string(.shortDescription)
        description = c.string(.description)
        bannerURL = c.optionalString(.banner).flatMap(URL.init(string:))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(type, forKey: .type)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(link?.absoluteString, forKey: .link)
        try c.encode(organisers, forKey: .organisers)
        try c.encode(airports, forKey: .airports)
        try c.encode(routes, forKey: .routes)
        try c.encode(FastISO8601.string(from: start), forKey: .start)
        try c.encode(FastISO8601.string(from: end), forKey: .end)
        try c.encode(shortDescription, forKey: .shortDescription)
        try c.encode(description, forKey: .description)
        try c.encodeIfPresent(bannerURL?.absoluteString, forKey: .banner)
    }

    public func isLive(at date: Date) -> Bool { start <= date && date < end }

    public var interval: DateInterval { DateInterval(start: start, end: max(start, end)) }

    /// Description with HTML tags stripped (the API returns HTML/markdown mixes).
    public var plainDescription: String {
        var s = description.replacingOccurrences(of: "<br>", with: "\n", options: .caseInsensitive)
        s = s.replacingOccurrences(of: "<br />", with: "\n", options: .caseInsensitive)
        s = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, char) in ["&amp;": "&", "&quot;": "\"", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "] {
            s = s.replacingOccurrences(of: entity, with: char)
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Envelope `{ "data": [...] }` used by the events API.
public struct DataEnvelope<T: Decodable>: Decodable {
    public var data: [T]

    enum CodingKeys: String, CodingKey { case data }

    public init(from decoder: Decoder) throws {
        if let c = try? decoder.container(keyedBy: CodingKeys.self) {
            data = c.lossyArray(T.self, forKey: .data)
        } else {
            data = try LossyArray<T>(from: decoder).elements
        }
    }
}
