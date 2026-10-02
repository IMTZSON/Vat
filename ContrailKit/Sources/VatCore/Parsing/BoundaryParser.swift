import Foundation

/// A FIR boundary from the VATSpy `Boundaries.geojson`.
public struct FIRBoundary: Sendable, Hashable, Identifiable {
    /// Boundary id (matches ``FIREntry/boundaryID``). Not unique: a few FIRs have several features.
    public var id: String
    public var isOceanic: Bool
    public var labelPoint: GeoPoint
    /// VATSIM region ("EMEA", "AMAS", "APAC").
    public var region: String
    /// VATSIM division ("VATEUD").
    public var division: String
    public var geometry: GeoMultiPolygon

    public init(id: String, isOceanic: Bool = false, labelPoint: GeoPoint? = nil, region: String = "",
                division: String = "", geometry: GeoMultiPolygon) {
        self.id = id
        self.isOceanic = isOceanic
        self.labelPoint = labelPoint ?? geometry.labelPoint
        self.region = region
        self.division = division
        self.geometry = geometry
    }
}

/// An approach/departure (or tower/centre sector) boundary from the SimAware TRACON project.
public struct TRACONBoundary: Sendable, Hashable {
    /// Boundary id ("A80", "N90"). Not unique: one feature per prefix/suffix combination.
    public var id: String
    /// Callsign prefixes, possibly including middle parts ("ATL", "LIRR_PN").
    public var prefixes: [String]
    /// Required callsign ending when present ("DEP", "APP", "TWR", "W_APP").
    public var suffix: String?
    public var name: String
    public var labelPoint: GeoPoint
    public var geometry: GeoMultiPolygon

    public init(id: String, prefixes: [String], suffix: String? = nil, name: String, labelPoint: GeoPoint? = nil,
                geometry: GeoMultiPolygon) {
        self.id = id
        self.prefixes = prefixes
        self.suffix = suffix
        self.name = name
        self.labelPoint = labelPoint ?? geometry.labelPoint
        self.geometry = geometry
    }
}

/// Parsers for the boundary GeoJSON files (Polygon and MultiPolygon geometries).
public enum BoundaryParser {
    /// Parses the VATSpy FIR boundaries (properties `id, oceanic, label_lon, label_lat, region, division`).
    public static func parseFIRs(_ data: Data) throws -> [FIRBoundary] {
        let collection = try GeoJSONFeatureCollection.decode(data)
        var result: [FIRBoundary] = []
        result.reserveCapacity(collection.features.count)
        for feature in collection.features {
            let p = feature.properties
            guard let geometry = feature.geometry, let id = p["id"]?.stringValue?.uppercased(), !id.isEmpty else { continue }
            let oceanic = p["oceanic"].map { ($0.intValue ?? 0) != 0 || $0.stringValue?.lowercased() == "true" } ?? false
            result.append(FIRBoundary(id: id, isOceanic: oceanic, labelPoint: label(p), region: p["region"]?.stringValue ?? "",
                                      division: p["division"]?.stringValue ?? "", geometry: geometry))
        }
        return result
    }

    /// Parses SimAware TRACON boundaries (properties `id, prefix (array or string), suffix?, name`).
    public static func parseTRACONs(_ data: Data) throws -> [TRACONBoundary] {
        let collection = try GeoJSONFeatureCollection.decode(data)
        var result: [TRACONBoundary] = []
        result.reserveCapacity(collection.features.count)
        for feature in collection.features {
            let p = feature.properties
            guard let geometry = feature.geometry, let id = p["id"]?.stringValue, !id.isEmpty else { continue }
            var prefixes: [String] = []
            if let list = p["prefix"]?.arrayValue {
                prefixes = list.compactMap { $0.stringValue?.uppercased() }
            } else if let single = p["prefix"]?.stringValue {
                prefixes = single.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
            }
            prefixes = prefixes.filter { !$0.isEmpty }
            if prefixes.isEmpty { prefixes = [id.uppercased()] }
            let suffix = p["suffix"]?.stringValue?.uppercased().trimmingCharacters(in: .whitespaces)
            result.append(TRACONBoundary(id: id.uppercased(), prefixes: prefixes,
                                         suffix: (suffix?.isEmpty ?? true) ? nil : suffix,
                                         name: p["name"]?.stringValue ?? id, labelPoint: label(p), geometry: geometry))
        }
        return result
    }

    public static func parseFIRs(contentsOf url: URL) throws -> [FIRBoundary] {
        try parseFIRs(Data(contentsOf: url, options: .mappedIfSafe))
    }

    public static func parseTRACONs(contentsOf url: URL) throws -> [TRACONBoundary] {
        try parseTRACONs(Data(contentsOf: url, options: .mappedIfSafe))
    }

    private static func label(_ p: [String: LenientJSON]) -> GeoPoint? {
        guard let lat = p["label_lat"]?.doubleValue, let lon = p["label_lon"]?.doubleValue,
              (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
        return GeoPoint(latitude: lat, longitude: lon)
    }
}
