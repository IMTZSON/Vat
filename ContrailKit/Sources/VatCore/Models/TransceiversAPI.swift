import Foundation

// Transceivers feed (audio for VATSIM): discovered via status.json `data.transceivers[]`.
// `[{"callsign":"LIRF_TWR","transceivers":[{"id":0,"frequency":118700000,"latDeg":41.8,"lonDeg":12.2,
//   "heightMslM":20.0,"heightAglM":10.0}]}]`

/// One radio transceiver of a station (controllers may use several to extend coverage).
public struct Transceiver: Codable, Sendable, Hashable, Identifiable {
    public var id: Int
    /// Frequency in Hz (118700000).
    public var frequencyHz: Int
    public var latitude: Double
    public var longitude: Double
    public var heightMslM: Double
    public var heightAglM: Double

    public init(id: Int, frequencyHz: Int, latitude: Double, longitude: Double, heightMslM: Double = 0, heightAglM: Double = 0) {
        self.id = id
        self.frequencyHz = frequencyHz
        self.latitude = latitude
        self.longitude = longitude
        self.heightMslM = heightMslM
        self.heightAglM = heightAglM
    }

    enum CodingKeys: String, CodingKey {
        case id, frequency
        case latitude = "latDeg"
        case longitude = "lonDeg"
        case heightMslM, heightAglM
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let frequency = c.int(.frequency), frequency > 0 else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing frequency"))
        }
        id = c.int(.id) ?? 0
        frequencyHz = frequency
        latitude = c.double(.latitude) ?? 0
        longitude = c.double(.longitude) ?? 0
        heightMslM = c.double(.heightMslM) ?? 0
        heightAglM = c.double(.heightAglM) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(frequencyHz, forKey: .frequency)
        try c.encode(latitude, forKey: .latitude)
        try c.encode(longitude, forKey: .longitude)
        try c.encode(heightMslM, forKey: .heightMslM)
        try c.encode(heightAglM, forKey: .heightAglM)
    }

    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }

    /// Frequency as shown on a radio, e.g. "118.700" or "132.835".
    public var frequencyMHzString: String {
        let khz = (frequencyHz + 500) / 1000
        let fraction = String(khz % 1000)
        return "\(khz / 1000)." + String(repeating: "0", count: 3 - fraction.count) + fraction
    }
}

/// One element of the transceivers feed.
public struct TransceiverStation: Decodable, Sendable, Hashable {
    public var callsign: String
    public var transceivers: [Transceiver]

    enum CodingKeys: String, CodingKey { case callsign, transceivers }

    public init(callsign: String, transceivers: [Transceiver]) {
        self.callsign = callsign
        self.transceivers = transceivers
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        callsign = c.string(.callsign).trimmingCharacters(in: .whitespaces).uppercased()
        guard !callsign.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Missing callsign"))
        }
        transceivers = c.lossyArray(Transceiver.self, forKey: .transceivers)
    }

    /// Decodes the feed into a dictionary keyed by callsign.
    public static func decodeFeed(_ data: Data) throws -> [String: [Transceiver]] {
        let stations = try JSONDecoder().decode(LossyArray<TransceiverStation>.self, from: data).elements
        var result = [String: [Transceiver]](minimumCapacity: stations.count)
        for station in stations { result[station.callsign, default: []].append(contentsOf: station.transceivers) }
        return result
    }
}
