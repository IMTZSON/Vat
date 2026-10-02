import Foundation

/// Interpolates aircraft between two consecutive snapshots for smooth replay.
///
/// - Positions move along the great circle (correct across the antimeridian), heading along the shortest
///   arc, altitude and groundspeed linearly.
/// - Pilots present only in the earlier snapshot stay (frozen) until the later snapshot's time, then
///   disappear; pilots present only in the later snapshot appear at its time. Hence the frame at
///   `from.timestamp` equals `from` and the frame at `to.timestamp` equals `to`.
/// - Jumps larger than `maxJumpNM` (reconnect/slew) are not interpolated: the aircraft snaps at the midpoint.
/// - Controllers switch at the later snapshot's time.
public enum ReplayInterpolator {
    public static let maxJumpNM = 300.0

    public static func interpolate(from a: CompactSnapshot, to b: CompactSnapshot, at date: Date) -> CompactSnapshot {
        let span = b.timestamp.timeIntervalSince(a.timestamp)
        guard span > 0 else { return date < b.timestamp ? a : b }
        if date <= a.timestamp { return relabel(a, date) }
        if date >= b.timestamp { return relabel(b, date) }
        let f = date.timeIntervalSince(a.timestamp) / span

        var later: [String: CompactPilot] = [:]
        for p in b.pilots { later[p.callsign] = p }

        var pilots: [CompactPilot] = []
        pilots.reserveCapacity(a.pilots.count)
        for p in a.pilots {
            guard let q = later[p.callsign], q.cid == p.cid else {
                pilots.append(p) // disappears at b.timestamp
                continue
            }
            pilots.append(interpolate(p, q, fraction: f))
        }
        return CompactSnapshot(timestamp: date, pilots: pilots, controllers: a.controllers)
    }

    /// Interpolates one pilot (same callsign) between two samples.
    public static func interpolate(_ p: CompactPilot, _ q: CompactPilot, fraction f: Double) -> CompactPilot {
        var r = f < 0.5 ? p : q
        let from = p.position, to = q.position
        let distance = from.distance(to: to)
        if distance <= maxJumpNM {
            let point = from.intermediate(to: to, fraction: f)
            r.lat = Float(point.latitude)
            r.lon = Float(GeoPoint.normalizeLongitude(point.longitude))
        }
        r.altitude = Int32(clamping: Int((Double(p.altitude) + (Double(q.altitude) - Double(p.altitude)) * f).rounded()))
        r.groundspeed = Int16(clamping: Int((Double(p.groundspeed) + (Double(q.groundspeed) - Double(p.groundspeed)) * f).rounded()))
        r.heading = Int16(clamping: Int(interpolateHeading(Double(p.heading), Double(q.heading), f).rounded()) % 360)
        return r
    }

    /// Shortest-arc heading interpolation, result in 0..<360.
    public static func interpolateHeading(_ h0: Double, _ h1: Double, _ f: Double) -> Double {
        var delta = (h1 - h0).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 }
        if delta < -180 { delta += 360 }
        var h = (h0 + delta * f).truncatingRemainder(dividingBy: 360)
        if h < 0 { h += 360 }
        return h
    }

    private static func relabel(_ s: CompactSnapshot, _ date: Date) -> CompactSnapshot {
        var copy = s
        copy.timestamp = date
        return copy
    }
}

/// Maps a replay slider (0…1) to snapshot frames.
public struct ReplayTimeline: Sendable, Hashable {
    /// Sorted, unique.
    public let timestamps: [Date]
    public let gapThreshold: TimeInterval

    public init(timestamps: [Date], gapThreshold: TimeInterval = 120) {
        self.timestamps = Array(Set(timestamps)).sorted()
        self.gapThreshold = gapThreshold
    }

    public var start: Date? { timestamps.first }
    public var end: Date? { timestamps.last }
    public var duration: TimeInterval {
        guard let start, let end else { return 0 }
        return end.timeIntervalSince(start)
    }
    public var isEmpty: Bool { timestamps.isEmpty }

    /// Periods longer than `gapThreshold` without snapshots (shown hatched on the slider).
    public var gaps: [DateInterval] {
        zip(timestamps, timestamps.dropFirst()).compactMap { a, b in
            b.timeIntervalSince(a) > gapThreshold ? DateInterval(start: a, end: b) : nil
        }
    }

    /// Date for a slider value (clamped to 0…1).
    public func date(forSliderValue value: Double) -> Date? {
        guard let start else { return nil }
        return start.addingTimeInterval(duration * min(1, max(0, value)))
    }

    public func sliderValue(for date: Date) -> Double {
        guard let start, duration > 0 else { return 0 }
        return min(1, max(0, date.timeIntervalSince(start) / duration))
    }

    /// Index of the last frame at or before the slider position.
    public func frameIndex(forSliderValue value: Double) -> Int? {
        guard let date = date(forSliderValue: value) else { return nil }
        return frameIndex(atOrBefore: date)
    }

    public func frameIndex(atOrBefore date: Date) -> Int? {
        guard !timestamps.isEmpty else { return nil }
        var lo = 0, hi = timestamps.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if timestamps[mid] <= date { lo = mid + 1 } else { hi = mid }
        }
        return max(0, lo - 1)
    }

    /// Frames bracketing `date` for interpolation, with the interpolation fraction. `isGap` is true when
    /// the two frames are further apart than `gapThreshold` (the UI should not interpolate across it).
    public func bracket(for date: Date) -> (lower: Int, upper: Int, fraction: Double, isGap: Bool)? {
        guard let i = frameIndex(atOrBefore: date) else { return nil }
        let j = min(i + 1, timestamps.count - 1)
        let span = timestamps[j].timeIntervalSince(timestamps[i])
        let f = span > 0 ? min(1, max(0, date.timeIntervalSince(timestamps[i]) / span)) : 0
        return (i, j, f, span > gapThreshold)
    }

    public func isInGap(_ date: Date) -> Bool { gaps.contains { $0.start < date && date < $0.end } }
}
