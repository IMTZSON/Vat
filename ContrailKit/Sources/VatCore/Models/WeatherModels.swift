import Foundation

// MARK: - RainViewer radar

/// One radar frame of the RainViewer manifest.
public struct RadarFrame: Codable, Sendable, Hashable, Identifiable {
    /// Unix time of the frame.
    public var time: Int
    /// Path to append to the host ("/v2/radar/1609395600").
    public var path: String

    public var id: Int { time }
    public var date: Date { Date(timeIntervalSince1970: TimeInterval(time)) }

    public init(time: Int, path: String) {
        self.time = time
        self.path = path
    }

    enum CodingKeys: String, CodingKey { case time, path }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let time = c.int(.time), let path = c.optionalString(.path), !path.isEmpty else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad frame"))
        }
        self.time = time
        self.path = path
    }
}

/// RainViewer `weather-maps.json` (radar only; since 2026 nowcast/satellite are gone, max zoom 7).
public struct RadarManifest: Codable, Sendable, Hashable {
    /// RainViewer serves radar tiles up to zoom 7 (DECISIONS D-010); scale parent tiles above.
    public static let maxZoom = 7

    public var host: String
    public var generated: Date?
    /// Past frames followed by any nowcast frames, oldest first.
    public var frames: [RadarFrame]

    public init(host: String, generated: Date? = nil, frames: [RadarFrame]) {
        self.host = host
        self.generated = generated
        self.frames = frames
    }

    enum CodingKeys: String, CodingKey { case host, generated, radar }
    enum RadarKeys: String, CodingKey { case past, nowcast }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        host = c.string(.host, default: "https://tilecache.rainviewer.com")
        generated = c.double(.generated).map { Date(timeIntervalSince1970: $0) }
        var frames: [RadarFrame] = []
        if let radar = try? c.nestedContainer(keyedBy: RadarKeys.self, forKey: .radar) {
            frames = radar.lossyArray(RadarFrame.self, forKey: .past) + radar.lossyArray(RadarFrame.self, forKey: .nowcast)
        }
        self.frames = frames.sorted { $0.time < $1.time }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(host, forKey: .host)
        try c.encodeIfPresent(generated?.timeIntervalSince1970, forKey: .generated)
        var radar = c.nestedContainer(keyedBy: RadarKeys.self, forKey: .radar)
        try radar.encode(frames, forKey: .past)
    }

    /// Most recent frame.
    public var latestFrame: RadarFrame? { frames.last }

    /// Tile URL template with `{z}`, `{x}`, `{y}` placeholders (256 px, colour scheme 2, smooth, snow).
    public func tileURLTemplate(frame: RadarFrame) -> String {
        "\(host)\(frame.path)/256/{z}/{x}/{y}/2/1_1.png"
    }

    /// Concrete tile URL (zoom clamped to ``maxZoom`` by the caller's overlay).
    public func tileURL(frame: RadarFrame, z: Int, x: Int, y: Int) -> URL? {
        URL(string: "\(host)\(frame.path)/256/\(z)/\(x)/\(y)/2/1_1.png")
    }
}

// MARK: - SIGMET

/// An international SIGMET or US AIRMET/SIGMET (aviationweather.gov GeoJSON).
public struct Sigmet: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// "TS", "TURB", "ICE", "VA", "MTW", "TC", "IFR", "MT_OBSC", "CONVECTIVE"…
    public var hazard: String
    /// "EMBD", "OBSC", "SEV", "FRQ"… (may be empty).
    public var qualifier: String
    public var firID: String
    public var firName: String
    public var validFrom: Date?
    public var validTo: Date?
    public var baseFt: Int?
    public var topFt: Int?
    public var rawText: String
    /// "SIGMET", "AIRMET", "OUTLOOK" (US), "ISIGMET" (international).
    public var kind: String
    public var geometry: GeoMultiPolygon?

    public init(id: String, hazard: String, qualifier: String = "", firID: String = "", firName: String = "",
                validFrom: Date? = nil, validTo: Date? = nil, baseFt: Int? = nil, topFt: Int? = nil,
                rawText: String = "", kind: String = "SIGMET", geometry: GeoMultiPolygon? = nil) {
        self.id = id
        self.hazard = hazard
        self.qualifier = qualifier
        self.firID = firID
        self.firName = firName
        self.validFrom = validFrom
        self.validTo = validTo
        self.baseFt = baseFt
        self.topFt = topFt
        self.rawText = rawText
        self.kind = kind
        self.geometry = geometry
    }

    public func isValid(at date: Date) -> Bool {
        (validFrom.map { $0 <= date } ?? true) && (validTo.map { date < $0 } ?? true)
    }
}

// MARK: - Winds aloft

/// Wind and temperature at one altitude.
public struct WindLevel: Codable, Sendable, Hashable {
    public var altitudeFt: Int
    /// Degrees true the wind blows from; 0 when light and variable.
    public var directionDeg: Int
    public var speedKt: Int
    public var temperatureC: Int?
    /// FD "9900": light and variable (< 5 kt).
    public var isLightAndVariable: Bool

    public init(altitudeFt: Int, directionDeg: Int, speedKt: Int, temperatureC: Int? = nil, isLightAndVariable: Bool = false) {
        self.altitudeFt = altitudeFt
        self.directionDeg = directionDeg
        self.speedKt = speedKt
        self.temperatureC = temperatureC
        self.isLightAndVariable = isLightAndVariable
    }
}

/// One station of the US FD winds/temperatures aloft forecast.
public struct WindsAloftStation: Codable, Sendable, Hashable, Identifiable {
    /// FD station identifier ("BOS").
    public var id: String
    public var position: GeoPoint?
    public var levels: [WindLevel]

    public init(id: String, position: GeoPoint? = nil, levels: [WindLevel]) {
        self.id = id
        self.position = position
        self.levels = levels
    }

    /// Level closest to `altitudeFt`.
    public func level(nearest altitudeFt: Int) -> WindLevel? {
        levels.min { abs($0.altitudeFt - altitudeFt) < abs($1.altitudeFt - altitudeFt) }
    }
}

/// A gridded wind sample (Open-Meteo, 250 hPa ≈ FL340).
public struct WindSample: Codable, Sendable, Hashable {
    public var point: GeoPoint
    public var directionDeg: Double
    public var speedKt: Double
    public var temperatureC: Double?
    public var altitudeFt: Int

    public init(point: GeoPoint, directionDeg: Double, speedKt: Double, temperatureC: Double? = nil, altitudeFt: Int = 34000) {
        self.point = point
        self.directionDeg = directionDeg
        self.speedKt = speedKt
        self.temperatureC = temperatureC
        self.altitudeFt = altitudeFt
    }
}
