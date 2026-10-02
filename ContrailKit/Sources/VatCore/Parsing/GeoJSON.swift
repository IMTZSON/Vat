import Foundation

/// Any JSON value, used for loosely-typed property bags (GeoJSON `properties`, AWC products).
public enum LenientJSON: Decodable, Sendable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([LenientJSON])
    case object([String: LenientJSON])
    case null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([LenientJSON].self) { self = .array(a); return }
        if let o = try? c.decode([String: LenientJSON].self) { self = .object(o); return }
        self = .null
    }

    /// String form (numbers rendered without a trailing ".0" when integral).
    public var stringValue: String? {
        switch self {
        case let .string(s): return s
        case let .number(d):
            if d.rounded() == d, abs(d) < 1e15 { return String(Int(d)) }
            return String(d)
        case let .bool(b): return b ? "true" : "false"
        default: return nil
        }
    }

    /// Numeric form (numeric strings accepted).
    public var doubleValue: Double? {
        switch self {
        case let .number(d): return d
        case let .string(s): return Double(s.trimmingCharacters(in: .whitespaces))
        case let .bool(b): return b ? 1 : 0
        default: return nil
        }
    }

    public var intValue: Int? { doubleValue.flatMap { $0.isFinite ? Int($0) : nil } }

    public var arrayValue: [LenientJSON]? {
        if case let .array(a) = self { return a }
        return nil
    }

    public subscript(key: String) -> LenientJSON? {
        if case let .object(o) = self { return o[key] }
        return nil
    }

    /// Date from an ISO-8601 string or epoch seconds (number or numeric string).
    public var dateValue: Date? {
        switch self {
        case let .number(d): return Date(timeIntervalSince1970: d > 1e11 ? d / 1000 : d)
        case let .string(s):
            if let date = FastISO8601.parse(s) { return date }
            if let d = Double(s) { return Date(timeIntervalSince1970: d > 1e11 ? d / 1000 : d) }
            return nil
        default: return nil
        }
    }
}

/// GeoJSON geometry decoder supporting Polygon and MultiPolygon (other types decode as `nil`).
/// Coordinates are `[lon, lat]`.
struct GeoJSONGeometry: Decodable {
    var multiPolygon: GeoMultiPolygon?

    enum CodingKeys: String, CodingKey { case type, coordinates }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = (try? c.decode(String.self, forKey: .type)) ?? ""
        switch type {
        case "Polygon":
            let rings = (try? c.decode([[[Double]]].self, forKey: .coordinates)) ?? []
            multiPolygon = Self.make([rings])
        case "MultiPolygon":
            let polygons = (try? c.decode([[[[Double]]]].self, forKey: .coordinates)) ?? []
            multiPolygon = Self.make(polygons)
        default:
            multiPolygon = nil
        }
    }

    static func make(_ polygons: [[[[Double]]]]) -> GeoMultiPolygon? {
        var result: [GeoPolygon] = []
        result.reserveCapacity(polygons.count)
        for rings in polygons {
            let converted = rings.map { ring -> [GeoPoint] in
                var points: [GeoPoint] = []
                points.reserveCapacity(ring.count)
                for pair in ring where pair.count >= 2 && pair[0].isFinite && pair[1].isFinite {
                    points.append(GeoPoint(latitude: pair[1], longitude: pair[0]))
                }
                return points
            }
            guard let outer = converted.first, outer.count >= 3 else { continue }
            result.append(GeoPolygon(outer: outer, holes: converted.dropFirst().filter { $0.count >= 3 }))
        }
        return result.isEmpty ? nil : GeoMultiPolygon(polygons: result)
    }
}

/// A GeoJSON Feature with free-form properties.
struct GeoJSONFeature: Decodable {
    var properties: [String: LenientJSON]
    var geometry: GeoMultiPolygon?

    enum CodingKeys: String, CodingKey { case properties, geometry }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        properties = (try? c.decodeIfPresent([String: LenientJSON].self, forKey: .properties)) ?? [:]
        geometry = (try? c.decodeIfPresent(GeoJSONGeometry.self, forKey: .geometry))??.multiPolygon
    }
}

/// A GeoJSON FeatureCollection; broken features are skipped.
struct GeoJSONFeatureCollection: Decodable {
    var features: [GeoJSONFeature]

    enum CodingKeys: String, CodingKey { case features }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        features = c.lossyArray(GeoJSONFeature.self, forKey: .features)
    }

    static func decode(_ data: Data) throws -> GeoJSONFeatureCollection {
        do {
            return try JSONDecoder().decode(GeoJSONFeatureCollection.self, from: data)
        } catch {
            throw NetworkError.decoding("GeoJSON: \(error)")
        }
    }
}
