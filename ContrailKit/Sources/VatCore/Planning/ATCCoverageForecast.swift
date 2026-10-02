import Foundation

/// A stretch of a route inside one airspace volume, with its expected coverage at the time of passage.
public struct CoverageSegment: Sendable, Hashable, Identifiable {
    public var volume: AirspaceVolume
    public var entry: Date
    public var exit: Date
    public var state: CoverageState
    /// Online controller expected to provide the service (state `.online`).
    public var controllerCallsign: String?
    /// Booking overlapping the passage (state `.booked`, or `.online` confirmed by a booking).
    public var booking: ATCBooking?
    public var entryDistanceNM: Double
    public var exitDistanceNM: Double

    public var id: String { "\(volume.id)@\(Int(entry.timeIntervalSince1970))" }
    public var duration: TimeInterval { max(0, exit.timeIntervalSince(entry)) }
}

/// Forecast of ATC coverage along a route.
///
/// Algorithm:
/// 1. sample the timeline every `sampleEveryNM` (20 NM) and find the volumes containing each sample
///    (volumes are pre-filtered by the route's bounding box);
/// 2. evaluate each containing volume at the sample's passage time and pick the **best state**
///    (online > booked > offline), ties broken by the **smallest airspace** (airport < TRACON < FIR < UIR):
///    a staffed CTR covers an unstaffed APP below it (top-down service);
/// 3. merge consecutive samples with the same volume/state/controller and refine boundaries by bisection;
/// 4. an offline segment becomes `.booked` if a booking for the volume overlaps the passage window.
///
/// Online-now controllers count as `.online` only if the passage is within `onlineHorizon` (2 h) of `now`,
/// or later if a booking for the same callsign still covers the passage time.
public enum ATCCoverageForecast {
    public typealias Matcher = @Sendable (String) -> [String]

    public static func forecast(
        timeline: RouteTimeline, volumes: [AirspaceVolume], online: [Controller], bookings: [ATCBooking],
        now: Date, matcher: Matcher, sampleEveryNM: Double = 20, onlineHorizon: TimeInterval = 2 * 3600
    ) -> [CoverageSegment] {
        let path = timeline.path
        let total = path.totalDistanceNM
        guard path.waypoints.count >= 2, total > 0 else { return [] }

        // Pre-filter volumes by the route bounds.
        let routeBounds = GeoBounds(points: path.densifiedPath(maxSegmentNM: 100))?.expanded(byDegrees: 1) ?? .world
        let candidates = volumes.filter { $0.bounds.intersects(routeBounds) }
        guard !candidates.isEmpty else { return [] }
        let candidateIDs = Set(candidates.map(\.id))

        // Index controllers and bookings by volume id.
        var onlineByVolume: [String: [Controller]] = [:]
        for c in online where c.position != .observer {
            for id in matcher(c.callsign) where candidateIDs.contains(id) { onlineByVolume[id, default: []].append(c) }
        }
        for key in onlineByVolume.keys {
            onlineByVolume[key]?.sort { ($0.isOnFrequency ? 0 : 1, $0.callsign) < ($1.isOnFrequency ? 0 : 1, $1.callsign) }
        }
        var bookingsByVolume: [String: [ATCBooking]] = [:]
        for b in bookings {
            for id in matcher(b.callsign) where candidateIDs.contains(id) { bookingsByVolume[id, default: []].append(b) }
        }
        for key in bookingsByVolume.keys { bookingsByVolume[key]?.sort { ($0.start, $0.callsign) < ($1.start, $1.callsign) } }

        struct Pick: Equatable {
            var volumeIndex: Int
            var state: CoverageState
            var callsign: String?
            var booking: ATCBooking?
        }

        func evaluate(_ volume: AirspaceVolume, at time: Date) -> (CoverageState, String?, ATCBooking?) {
            let volumeBookings = bookingsByVolume[volume.id] ?? []
            if let controllers = onlineByVolume[volume.id], let c = controllers.first {
                if time.timeIntervalSince(now) <= onlineHorizon {
                    return (.online, c.callsign, volumeBookings.first { $0.callsign == c.callsign && $0.isActive(at: time) })
                }
                for ctl in controllers {
                    if let b = volumeBookings.first(where: { $0.callsign == ctl.callsign && $0.isActive(at: time) }) {
                        return (.online, ctl.callsign, b)
                    }
                }
            }
            if let b = volumeBookings.first(where: { $0.isActive(at: time) }) {
                return (.booked, nil, b)
            }
            return (.offline, nil, nil)
        }

        func pick(at distance: Double) -> Pick? {
            guard let point = path.point(atDistanceNM: distance), let time = timeline.time(atDistanceNM: distance)
            else { return nil }
            var best: Pick?
            for (i, v) in candidates.enumerated() where v.contains(point) {
                let (state, callsign, booking) = evaluate(v, at: time)
                let candidate = Pick(volumeIndex: i, state: state, callsign: callsign, booking: booking)
                guard let current = best else { best = candidate; continue }
                if state > current.state {
                    best = candidate
                } else if state == current.state {
                    let a = sizeRank(v), b = sizeRank(candidates[current.volumeIndex])
                    if a < b || (a == b && v.id < candidates[current.volumeIndex].id) { best = candidate }
                }
            }
            return best
        }

        // Sample.
        let step = max(1, sampleEveryNM)
        var distances: [Double] = []
        var d = 0.0
        while d < total {
            distances.append(d)
            d += step
        }
        distances.append(total)
        let picks = distances.map(pick(at:))

        // Group runs.
        struct Run { var pick: Pick; var firstSample: Int; var lastSample: Int }
        var runs: [Run] = []
        for (i, p) in picks.enumerated() {
            guard let p else { continue }
            if var last = runs.last, last.pick.volumeIndex == p.volumeIndex, last.pick.state == p.state,
               last.pick.callsign == p.callsign, last.lastSample == i - 1 {
                last.lastSample = i
                if last.pick.booking == nil { last.pick.booking = p.booking }
                runs[runs.count - 1] = last
            } else {
                runs.append(Run(pick: p, firstSample: i, lastSample: i))
            }
        }

        // Refine boundaries by bisection on "the pick is still this run's pick".
        func boundary(inside: Double, outside: Double, run: Run) -> Double {
            var a = inside, b = outside
            for _ in 0..<8 {
                let m = (a + b) / 2
                if let p = pick(at: m), p.volumeIndex == run.pick.volumeIndex, p.state == run.pick.state,
                   p.callsign == run.pick.callsign {
                    a = m
                } else {
                    b = m
                }
            }
            return (a + b) / 2
        }

        var segments: [CoverageSegment] = []
        for run in runs {
            let volume = candidates[run.pick.volumeIndex]
            var startD = distances[run.firstSample]
            var endD = distances[run.lastSample]
            if run.firstSample > 0 {
                startD = boundary(inside: startD, outside: distances[run.firstSample - 1], run: run)
            }
            if run.lastSample < distances.count - 1 {
                endD = boundary(inside: endD, outside: distances[run.lastSample + 1], run: run)
            }
            let entry = timeline.time(atDistanceNM: startD) ?? now
            let exit = timeline.time(atDistanceNM: endD) ?? entry
            var state = run.pick.state
            var booking = run.pick.booking
            if state == .offline, let b = (bookingsByVolume[volume.id] ?? []).first(where: {
                $0.overlaps(DateInterval(start: entry, end: max(entry, exit)))
            }) {
                state = .booked
                booking = b
            }
            segments.append(CoverageSegment(
                volume: volume, entry: entry, exit: exit, state: state, controllerCallsign: run.pick.callsign,
                booking: booking, entryDistanceNM: startD, exitDistanceNM: endD
            ))
        }
        // Make contiguous segments share their boundary times.
        for i in segments.indices.dropFirst() where runs[i - 1].lastSample + 1 == runs[i].firstSample {
            segments[i].entry = segments[i - 1].exit
            segments[i].entryDistanceNM = segments[i - 1].exitDistanceNM
        }
        return segments
    }

    /// Fraction (0…1) of the flight **time** spent in segments whose state is in `counting`.
    public static func coveragePercent(
        _ segments: [CoverageSegment], timeline: RouteTimeline, counting: Set<CoverageState> = [.online]
    ) -> Double {
        let total = timeline.duration
        guard total > 0 else { return 0 }
        let covered = segments.filter { counting.contains($0.state) }.reduce(0) { $0 + $1.duration }
        return min(1, covered / total)
    }

    /// Smaller is more specific.
    static func sizeRank(_ v: AirspaceVolume) -> Int {
        switch v.kind {
        case .airport: 0
        case .tracon: 1
        case .fir: 2
        case .uir: 3
        }
    }

    /// Simple matcher based on `AirspaceVolume.callsignPrefixes` / `callsignSuffix` (exact prefix match on
    /// the part before the first underscore, or on the joined prefix + middle parts, e.g. "EDGG_E").
    /// The sector database provides a richer one; this is enough for tests and previews.
    public static func prefixMatcher(volumes: [AirspaceVolume]) -> Matcher {
        let entries = volumes.map { (id: $0.id, kind: $0.kind, prefixes: Set($0.callsignPrefixes.map { $0.uppercased() }),
                                     suffix: $0.callsignSuffix?.uppercased()) }
        return { callsign in
            let parts = callsign.uppercased().split(separator: "_").map(String.init)
            guard let first = parts.first else { return [] }
            let suffix = parts.count > 1 ? parts[parts.count - 1] : ""
            let position = ATCPosition(callsign: callsign, facility: .observer)
            var keys: Set<String> = [first]
            if parts.count > 2 { keys.insert(parts.dropLast().joined(separator: "_")) }
            return entries.filter { e in
                guard !e.prefixes.isDisjoint(with: keys) else { return false }
                if let s = e.suffix, s != suffix { return false }
                switch e.kind {
                case .airport: return position.isAirportLocal
                case .tracon: return position == .approach || position == .departure
                case .fir, .uir: return position == .center || position == .flightService
                }
            }.map(\.id)
        }
    }
}
