import Foundation

/// A WGS-84 coordinate. Foundation-only so that VatCore builds everywhere (no CoreLocation).
public struct GeoPoint: Codable, Sendable, Hashable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    public static let earthRadiusNM = 3440.065

    var latRad: Double { latitude * .pi / 180 }
    var lonRad: Double { longitude * .pi / 180 }

    /// Great-circle distance in nautical miles (haversine).
    public func distance(to other: GeoPoint) -> Double {
        let dLat = other.latRad - latRad
        let dLon = other.lonRad - lonRad
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(latRad) * cos(other.latRad) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * Self.earthRadiusNM * atan2(sqrt(a), sqrt(max(0, 1 - a)))
    }

    /// Initial true bearing to `other`, 0..<360.
    public func bearing(to other: GeoPoint) -> Double {
        let dLon = other.lonRad - lonRad
        let y = sin(dLon) * cos(other.latRad)
        let x = cos(latRad) * sin(other.latRad) - sin(latRad) * cos(other.latRad) * cos(dLon)
        let deg = atan2(y, x) * 180 / .pi
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Point reached travelling `distanceNM` along the great circle with initial `bearing` (degrees).
    public func destination(bearing: Double, distanceNM: Double) -> GeoPoint {
        let delta = distanceNM / Self.earthRadiusNM
        let theta = bearing * .pi / 180
        let lat2 = asin(sin(latRad) * cos(delta) + cos(latRad) * sin(delta) * cos(theta))
        let lon2 = lonRad + atan2(sin(theta) * sin(delta) * cos(latRad), cos(delta) - sin(latRad) * sin(lat2))
        return GeoPoint(latitude: lat2 * 180 / .pi, longitude: Self.normalizeLongitude(lon2 * 180 / .pi))
    }

    /// Point at `fraction` (0…1) along the great circle to `other`.
    public func intermediate(to other: GeoPoint, fraction: Double) -> GeoPoint {
        let d = distance(to: other) / Self.earthRadiusNM
        guard d > 1e-9 else { return self }
        let a = sin((1 - fraction) * d) / sin(d)
        let b = sin(fraction * d) / sin(d)
        let x = a * cos(latRad) * cos(lonRad) + b * cos(other.latRad) * cos(other.lonRad)
        let y = a * cos(latRad) * sin(lonRad) + b * cos(other.latRad) * sin(other.lonRad)
        let z = a * sin(latRad) + b * sin(other.latRad)
        let lat = atan2(z, sqrt(x * x + y * y))
        let lon = atan2(y, x)
        return GeoPoint(latitude: lat * 180 / .pi, longitude: lon * 180 / .pi)
    }

    /// Densified great-circle path including both endpoints, segments ≤ `maxSegmentNM`.
    public func greatCirclePath(to other: GeoPoint, maxSegmentNM: Double = 100) -> [GeoPoint] {
        let total = distance(to: other)
        let steps = max(1, Int((total / maxSegmentNM).rounded(.up)))
        return (0...steps).map { intermediate(to: other, fraction: Double($0) / Double(steps)) }
    }

    /// Signed cross-track distance (NM) of `self` from the great circle `start → end`.
    public func crossTrackDistance(from start: GeoPoint, to end: GeoPoint) -> Double {
        let d13 = start.distance(to: self) / Self.earthRadiusNM
        let t13 = start.bearing(to: self) * .pi / 180
        let t12 = start.bearing(to: end) * .pi / 180
        return asin(sin(d13) * sin(t13 - t12)) * Self.earthRadiusNM
    }

    /// Along-track distance (NM) from `start` of the closest point on the great circle `start → end`.
    public func alongTrackDistance(from start: GeoPoint, to end: GeoPoint) -> Double {
        let d13 = start.distance(to: self) / Self.earthRadiusNM
        let xt = crossTrackDistance(from: start, to: end) / Self.earthRadiusNM
        let cosXt = cos(xt)
        guard abs(cosXt) > 1e-12 else { return 0 }
        let value = max(-1, min(1, cos(d13) / cosXt))
        let along = acos(value) * Self.earthRadiusNM
        // Negative when the point is "behind" start.
        let t13 = start.bearing(to: self), t12 = start.bearing(to: end)
        var diff = abs(t13 - t12).truncatingRemainder(dividingBy: 360)
        if diff > 180 { diff = 360 - diff }
        return diff > 90 ? -along : along
    }

    public static func normalizeLongitude(_ lon: Double) -> Double {
        var l = (lon + 180).truncatingRemainder(dividingBy: 360)
        if l < 0 { l += 360 }
        return l - 180
    }

    public var isValid: Bool {
        latitude.isFinite && longitude.isFinite && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
}

/// Axis-aligned bounding box in degrees. Boxes crossing the antimeridian have `minLon > maxLon`.
public struct GeoBounds: Codable, Sendable, Hashable {
    public var minLat: Double
    public var maxLat: Double
    public var minLon: Double
    public var maxLon: Double

    public init(minLat: Double, maxLat: Double, minLon: Double, maxLon: Double) {
        self.minLat = minLat
        self.maxLat = maxLat
        self.minLon = minLon
        self.maxLon = maxLon
    }

    /// Bounds of a set of points. Longitudes outside [-180, 180] (used by some boundary files to
    /// cross the antimeridian) are normalised and the box wraps when that gives a smaller span.
    public init?(points: some Sequence<GeoPoint>) {
        var minLat = Double.infinity, maxLat = -Double.infinity
        var minLon = Double.infinity, maxLon = -Double.infinity
        var minLonShifted = Double.infinity, maxLonShifted = -Double.infinity
        var any = false
        for p in points {
            any = true
            minLat = min(minLat, p.latitude)
            maxLat = max(maxLat, p.latitude)
            let lon = GeoPoint.normalizeLongitude(p.longitude)
            minLon = min(minLon, lon)
            maxLon = max(maxLon, lon)
            let shifted = lon < 0 ? lon + 360 : lon
            minLonShifted = min(minLonShifted, shifted)
            maxLonShifted = max(maxLonShifted, shifted)
        }
        guard any else { return nil }
        self.minLat = minLat
        self.maxLat = maxLat
        if maxLonShifted - minLonShifted < maxLon - minLon {
            self.minLon = GeoPoint.normalizeLongitude(minLonShifted)
            self.maxLon = GeoPoint.normalizeLongitude(maxLonShifted)
        } else {
            self.minLon = minLon
            self.maxLon = maxLon
        }
    }

    public var crossesAntimeridian: Bool { minLon > maxLon }

    public func contains(_ p: GeoPoint) -> Bool {
        guard p.latitude >= minLat, p.latitude <= maxLat else { return false }
        let lon = GeoPoint.normalizeLongitude(p.longitude)
        if crossesAntimeridian { return lon >= minLon || lon <= maxLon }
        return lon >= minLon && lon <= maxLon
    }

    public func intersects(_ other: GeoBounds) -> Bool {
        guard minLat <= other.maxLat, maxLat >= other.minLat else { return false }
        func ranges(_ b: GeoBounds) -> [(Double, Double)] {
            b.crossesAntimeridian ? [(b.minLon, 180), (-180, b.maxLon)] : [(b.minLon, b.maxLon)]
        }
        for a in ranges(self) {
            for b in ranges(other) where a.0 <= b.1 && a.1 >= b.0 { return true }
        }
        return false
    }

    public var center: GeoPoint {
        let lat = (minLat + maxLat) / 2
        if crossesAntimeridian {
            return GeoPoint(latitude: lat, longitude: GeoPoint.normalizeLongitude((minLon + maxLon + 360) / 2))
        }
        return GeoPoint(latitude: lat, longitude: (minLon + maxLon) / 2)
    }

    public func expanded(byDegrees d: Double) -> GeoBounds {
        GeoBounds(
            minLat: max(-90, minLat - d), maxLat: min(90, maxLat + d),
            minLon: GeoPoint.normalizeLongitude(minLon - d), maxLon: GeoPoint.normalizeLongitude(maxLon + d)
        )
    }

    public static let world = GeoBounds(minLat: -90, maxLat: 90, minLon: -180, maxLon: 180)
}
