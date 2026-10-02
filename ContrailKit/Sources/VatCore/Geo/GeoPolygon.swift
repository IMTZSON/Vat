import Foundation

/// A polygon with an outer ring and optional holes. Rings are closed or open; both are accepted.
public struct GeoPolygon: Codable, Sendable, Hashable {
    public var outer: [GeoPoint]
    public var holes: [[GeoPoint]]
    public let bounds: GeoBounds

    public init(outer: [GeoPoint], holes: [[GeoPoint]] = []) {
        self.outer = outer
        self.holes = holes
        self.bounds = GeoBounds(points: outer) ?? .world
    }

    /// Point-in-polygon (even-odd ray casting). Longitudes are unwrapped relative to the test point
    /// so polygons crossing the antimeridian (e.g. Pacific FIRs) work.
    public func contains(_ point: GeoPoint) -> Bool {
        guard bounds.contains(point) else { return false }
        guard Self.ring(outer, contains: point) else { return false }
        for hole in holes where Self.ring(hole, contains: point) { return false }
        return true
    }

    static func ring(_ ring: [GeoPoint], contains p: GeoPoint) -> Bool {
        guard ring.count >= 3 else { return false }
        let px = p.longitude, py = p.latitude
        var inside = false
        var j = ring.count - 1
        for i in 0..<ring.count {
            let xi = unwrap(ring[i].longitude, around: px), yi = ring[i].latitude
            let xj = unwrap(ring[j].longitude, around: px), yj = ring[j].latitude
            if (yi > py) != (yj > py) {
                let x = (xj - xi) * (py - yi) / (yj - yi) + xi
                if px < x { inside.toggle() }
            }
            j = i
        }
        return inside
    }

    /// Brings `lon` within ±180° of `reference`.
    static func unwrap(_ lon: Double, around reference: Double) -> Double {
        var l = lon
        while l - reference > 180 { l -= 360 }
        while l - reference < -180 { l += 360 }
        return l
    }

    /// Approximate area-weighted centroid of the outer ring (planar, good enough for label placement).
    public var centroid: GeoPoint {
        guard outer.count >= 3 else { return outer.first ?? bounds.center }
        let ref = outer[0].longitude
        var a = 0.0, cx = 0.0, cy = 0.0
        for i in 0..<outer.count {
            let p0 = outer[i], p1 = outer[(i + 1) % outer.count]
            let x0 = Self.unwrap(p0.longitude, around: ref), x1 = Self.unwrap(p1.longitude, around: ref)
            let cross = x0 * p1.latitude - x1 * p0.latitude
            a += cross
            cx += (x0 + x1) * cross
            cy += (p0.latitude + p1.latitude) * cross
        }
        guard abs(a) > 1e-12 else { return bounds.center }
        return GeoPoint(latitude: cy / (3 * a), longitude: GeoPoint.normalizeLongitude(cx / (3 * a)))
    }
}

/// A set of polygons (GeoJSON MultiPolygon).
public struct GeoMultiPolygon: Codable, Sendable, Hashable {
    public var polygons: [GeoPolygon]
    public let bounds: GeoBounds

    public init(polygons: [GeoPolygon]) {
        self.polygons = polygons
        self.bounds = GeoBounds(points: polygons.flatMap(\.outer)) ?? .world
    }

    public func contains(_ point: GeoPoint) -> Bool {
        guard bounds.contains(point) else { return false }
        return polygons.contains { $0.contains(point) }
    }

    /// Centroid of the largest polygon (by bounding-box area).
    public var labelPoint: GeoPoint {
        let largest = polygons.max { a, b in
            (a.bounds.maxLat - a.bounds.minLat) * abs(a.bounds.maxLon - a.bounds.minLon)
                < (b.bounds.maxLat - b.bounds.minLat) * abs(b.bounds.maxLon - b.bounds.minLon)
        }
        return largest?.centroid ?? bounds.center
    }
}
