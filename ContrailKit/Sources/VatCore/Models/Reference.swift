import Foundation

// Shared reference models used across VatCore modules (data, sectors, planning, social).

/// An airport from VATSpy.dat, enriched with OurAirports extras (elevation, country, city).
public struct Airport: Codable, Sendable, Hashable, Identifiable {
    public var icao: String
    public var name: String
    public var latitude: Double
    public var longitude: Double
    /// IATA code or FAA LID (VATSpy column), may be empty.
    public var iata: String
    /// Owning FIR identifier (VATSpy).
    public var fir: String
    /// VATSpy "pseudo" airports are alternative callsign prefixes, not real airfields.
    public var isPseudo: Bool
    public var elevationFt: Int
    /// ISO 3166-1 alpha-2 country code ("IT"), empty if unknown.
    public var country: String
    public var city: String
    public var hasScheduledService: Bool

    public var id: String { icao }
    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }

    public init(
        icao: String, name: String, latitude: Double, longitude: Double, iata: String = "", fir: String = "",
        isPseudo: Bool = false, elevationFt: Int = 0, country: String = "", city: String = "",
        hasScheduledService: Bool = false
    ) {
        self.icao = icao
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.iata = iata
        self.fir = fir
        self.isPseudo = isPseudo
        self.elevationFt = elevationFt
        self.country = country
        self.city = city
        self.hasScheduledService = hasScheduledService
    }
}

/// Radio navigation aid (OurAirports, public domain).
public struct Navaid: Codable, Sendable, Hashable {
    public var ident: String
    public var name: String
    /// "VOR", "VOR-DME", "VORTAC", "TACAN", "NDB", "NDB-DME", "DME".
    public var type: String
    public var latitude: Double
    public var longitude: Double
    public var frequencyKHz: Int?
    public var country: String

    public var position: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }

    public init(ident: String, name: String, type: String, latitude: Double, longitude: Double,
                frequencyKHz: Int? = nil, country: String = "") {
        self.ident = ident
        self.name = name
        self.type = type
        self.latitude = latitude
        self.longitude = longitude
        self.frequencyKHz = frequencyKHz
        self.country = country
    }
}

/// A resolved point of a route (airport, navaid, fix from SimBrief, explicit coordinate).
public struct Waypoint: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable, Hashable {
        case airport, navaid, fix, coordinate, aircraft
    }

    public var ident: String
    public var name: String
    public var kind: Kind
    public var point: GeoPoint
    /// Planned altitude at this point in feet, when known (SimBrief).
    public var plannedAltitudeFt: Int?
    /// Airway used to reach this point, when known.
    public var via: String?

    public init(ident: String, name: String = "", kind: Kind, point: GeoPoint,
                plannedAltitudeFt: Int? = nil, via: String? = nil) {
        self.ident = ident
        self.name = name
        self.kind = kind
        self.point = point
        self.plannedAltitudeFt = plannedAltitudeFt
        self.via = via
    }
}

/// Looks up candidate points for a route identifier. Implemented by the airport/navaid databases.
public protocol WaypointLookup: Sendable {
    /// All points named `ident` (navaids are not unique worldwide). Order is not significant.
    func candidates(for ident: String) -> [Waypoint]
}

/// A controlled airspace volume that may be staffed by one or more controller callsigns.
///
/// - FIR/UIR (CTR/FSS) and TRACON (APP/DEP) volumes carry polygon `geometry`.
/// - Airport-local positions (TWR/GND/DEL/ATIS) and APP without a published TRACON use
///   `center` + `radiusNM` (DECISIONS D-013).
public struct AirspaceVolume: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable, Hashable {
        case fir, uir, tracon, airport
    }

    /// Stable identifier, e.g. "FIR:LIRR", "UIR:EURM", "TRACON:A80", "APT:LIRF".
    public var id: String
    public var kind: Kind
    /// Human-readable name ("Roma Control", "Atlanta Approach").
    public var name: String
    /// Callsign prefixes that staff this volume ("LIRR", "EDGG_E"), uppercase.
    public var callsignPrefixes: [String]
    /// Optional suffix restriction ("DEP" for SimAware departure-only boundaries).
    public var callsignSuffix: String?
    public var geometry: GeoMultiPolygon?
    public var center: GeoPoint
    public var radiusNM: Double
    /// True for oceanic FIRs.
    public var isOceanic: Bool
    /// VATSIM region/division when known ("EMEA", "VATEUD").
    public var region: String
    public var division: String

    public init(
        id: String, kind: Kind, name: String, callsignPrefixes: [String], callsignSuffix: String? = nil,
        geometry: GeoMultiPolygon? = nil, center: GeoPoint, radiusNM: Double = 0, isOceanic: Bool = false,
        region: String = "", division: String = ""
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.callsignPrefixes = callsignPrefixes
        self.callsignSuffix = callsignSuffix
        self.geometry = geometry
        self.center = center
        self.radiusNM = radiusNM
        self.isOceanic = isOceanic
        self.region = region
        self.division = division
    }

    public func contains(_ point: GeoPoint) -> Bool {
        if let geometry { return geometry.contains(point) }
        return radiusNM > 0 && center.distance(to: point) <= radiusNM
    }

    public var bounds: GeoBounds {
        if let geometry { return geometry.bounds }
        let dLat = radiusNM / 60
        let dLon = radiusNM / max(1, 60 * cos(center.latitude * .pi / 180))
        return GeoBounds(
            minLat: max(-90, center.latitude - dLat), maxLat: min(90, center.latitude + dLat),
            minLon: GeoPoint.normalizeLongitude(center.longitude - dLon),
            maxLon: GeoPoint.normalizeLongitude(center.longitude + dLon)
        )
    }
}

/// Coverage state of an airspace or airport, used consistently across the UI
/// (green = online, amber = booked, grey = offline).
public enum CoverageState: String, Codable, Sendable, Hashable, Comparable {
    case offline, booked, online

    var order: Int {
        switch self {
        case .offline: 0
        case .booked: 1
        case .online: 2
        }
    }

    public static func < (lhs: CoverageState, rhs: CoverageState) -> Bool { lhs.order < rhs.order }
}
