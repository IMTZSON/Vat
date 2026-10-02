import Foundation

/// One observed position of an aircraft.
public struct TrackPoint: Codable, Sendable, Hashable {
    public var time: Date
    public var position: GeoPoint
    /// Feet MSL.
    public var altitudeFt: Int
    public var groundspeedKt: Int
    /// Degrees true, 0–359.
    public var headingDeg: Int

    public init(time: Date, position: GeoPoint, altitudeFt: Int, groundspeedKt: Int, headingDeg: Int) {
        self.time = time
        self.position = position
        self.altitudeFt = altitudeFt
        self.groundspeedKt = groundspeedKt
        self.headingDeg = headingDeg
    }

    public init(pilot: Pilot, at time: Date) {
        self.init(time: time, position: pilot.position, altitudeFt: pilot.altitude,
                  groundspeedKt: pilot.groundspeed, headingDeg: pilot.heading)
    }

    /// True when nothing meaningful changed compared with `other` (used for de-duplication).
    func isEssentiallyEqual(to other: TrackPoint) -> Bool {
        position.distance(to: other.position) < 0.05
            && abs(altitudeFt - other.altitudeFt) < 50
            && abs(groundspeedKt - other.groundspeedKt) < 5
            && headingDeg == other.headingDeg
    }
}

/// Bounded, persistable history of an aircraft's positions.
///
/// - Points arriving out of order are ignored; unchanged points less than `minimumInterval` after the
///   previous one are skipped (a parked aircraft is still sampled once a minute).
/// - When `maxPoints` is exceeded the **older half** of the track is decimated (every other point is
///   dropped, the very first point is kept), so the start of the flight is never lost and recent
///   history keeps full resolution.
/// - `distanceFlownNM` is accumulated on append, so it is not affected by downsampling.
public struct FlightTrack: Codable, Sendable, Hashable {
    public private(set) var points: [TrackPoint]
    public private(set) var distanceFlownNM: Double
    public var maxPoints: Int
    public var minimumInterval: TimeInterval

    public init(maxPoints: Int = 1_000, minimumInterval: TimeInterval = 60, points: [TrackPoint] = []) {
        self.maxPoints = max(8, maxPoints)
        self.minimumInterval = minimumInterval
        self.points = []
        self.distanceFlownNM = 0
        for p in points { append(p) }
    }

    public var isEmpty: Bool { points.isEmpty }
    public var count: Int { points.count }
    public var first: TrackPoint? { points.first }
    public var last: TrackPoint? { points.last }
    public var maxAltitudeFt: Int { points.map(\.altitudeFt).max() ?? 0 }
    public var duration: TimeInterval {
        guard let first, let last else { return 0 }
        return last.time.timeIntervalSince(first.time)
    }

    /// Appends a point. Returns `false` when the point was ignored (duplicate or out of order).
    @discardableResult
    public mutating func append(_ point: TrackPoint) -> Bool {
        guard point.position.isValid else { return false }
        if let last = points.last {
            guard point.time > last.time else { return false }
            if point.isEssentiallyEqual(to: last), point.time.timeIntervalSince(last.time) < minimumInterval {
                return false
            }
            let leg = last.position.distance(to: point.position)
            // Ignore teleports (reconnects/slews) in the distance: more than 1.5× a 700 kt aircraft.
            let dt = point.time.timeIntervalSince(last.time)
            if leg <= max(5, 700 * 1.5 * dt / 3600) { distanceFlownNM += leg }
        }
        points.append(point)
        if points.count > maxPoints { downsample() }
        return true
    }

    @discardableResult
    public mutating func append(pilot: Pilot, at time: Date) -> Bool {
        append(TrackPoint(pilot: pilot, at: time))
    }

    private mutating func downsample() {
        let olderCount = points.count / 2
        var result: [TrackPoint] = []
        result.reserveCapacity(points.count)
        result.append(points[0])
        var i = 2
        while i < olderCount {
            result.append(points[i])
            i += 2
        }
        result.append(contentsOf: points[olderCount...])
        points = result
    }

    /// Vertical rate in feet per minute over the last `window` seconds (default ~2 min).
    /// Returns `nil` with fewer than two points spanning at least 20 s.
    public func verticalRateFpm(window: TimeInterval = 120) -> Double? {
        guard let last = points.last, points.count >= 2 else { return nil }
        var reference: TrackPoint?
        for p in points.reversed().dropFirst() {
            let dt = last.time.timeIntervalSince(p.time)
            if dt > window {
                // Use this point only if nothing closer within the window was found.
                if reference == nil, dt <= window * 2.5 { reference = p }
                break
            }
            reference = p
        }
        guard let ref = reference else { return nil }
        let dt = last.time.timeIntervalSince(ref.time)
        guard dt >= 20 else { return nil }
        return Double(last.altitudeFt - ref.altitudeFt) / (dt / 60)
    }

    /// Points within `interval`.
    public func points(in interval: DateInterval) -> [TrackPoint] {
        points.filter { interval.contains($0.time) }
    }
}
