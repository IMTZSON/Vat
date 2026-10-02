import Foundation

/// Estimated times along a route: when each waypoint is reached and where the aircraft is at any time.
///
/// Two ways to build it:
/// - **planned** (`init(route:departureTime:cruiseTASKnots:)`): from a departure time and the
///   `SpeedProfile` (climb 250 → TAS over ~150 NM, cruise, descent over the last ~120 NM);
/// - **live** (`init(route:aircraft:groundspeedKt:filedTASKt:now:estimate:)`): from the aircraft's current
///   position along the route, consistent with `ETACalculator`, optionally scaled to match an `ETAEstimate`.
public struct RouteTimeline: Sendable, Hashable {
    public struct Entry: Sendable, Hashable {
        public var waypoint: Waypoint
        public var time: Date
        public var distanceFromStartNM: Double
    }

    public struct Sample: Sendable, Hashable {
        public var distanceNM: Double
        public var time: Date
    }

    /// The path that is timed (for live timelines it starts at the aircraft position).
    public let path: ResolvedRoute
    public let entries: [Entry]
    /// Monotonic (distance, time) table used for interpolation.
    public let samples: [Sample]

    public var start: Date? { samples.first?.time }
    public var end: Date? { samples.last?.time }
    public var duration: TimeInterval { (end?.timeIntervalSince(start ?? .distantPast)).map { max(0, $0) } ?? 0 }
    public var interval: DateInterval? {
        guard let start, let end else { return nil }
        return DateInterval(start: start, end: max(start, end))
    }
    public var totalDistanceNM: Double { path.totalDistanceNM }

    /// Waypoints with their estimated time over.
    public var waypointTimes: [(waypoint: Waypoint, time: Date)] { entries.map { ($0.waypoint, $0.time) } }

    /// Builds a timeline from a table of times; `timeAt` must be non-decreasing in distance.
    init(path: ResolvedRoute, timeAt: (Double) -> Date) {
        self.path = path
        let total = path.totalDistanceNM
        var samples: [Sample] = []
        let step = max(2, total / 500)
        var d = 0.0
        while d < total {
            samples.append(Sample(distanceNM: d, time: timeAt(d)))
            d += step
        }
        samples.append(Sample(distanceNM: total, time: timeAt(total)))
        self.samples = samples
        self.entries = path.waypoints.indices.map { i in
            let distance = path.cumulativeDistanceNM[i]
            return Entry(waypoint: path.waypoints[i], time: timeAt(distance), distanceFromStartNM: distance)
        }
    }

    /// Planned timeline from a departure (take-off) time.
    public init(route: ResolvedRoute, departureTime: Date, cruiseTASKnots: Double,
                climbNM: Double = 150, descentNM: Double = 120) {
        let profile = SpeedProfile(cruiseKt: cruiseTASKnots, climbNM: climbNM, descentNM: descentNM)
        let total = route.totalDistanceNM
        self.init(path: route) { d in
            departureTime.addingTimeInterval(profile.timeFromStart(toDistance: d, total: total))
        }
    }

    /// Planned timeline for a flight plan: departure time from `deptime` (relative to `now`), TAS from
    /// the plan (default 420 kt). If the plan has an en-route time, the profile is scaled to match it.
    public init(route: ResolvedRoute, flightPlan: FlightPlan, now: Date, defaultTASKnots: Double = 420) {
        let departure = flightPlan.departureDate(relativeTo: now) ?? now
        let tas = flightPlan.cruiseSpeedKnots.map(Double.init) ?? defaultTASKnots
        let profile = SpeedProfile(cruiseKt: tas)
        let total = route.totalDistanceNM
        let modelled = profile.timeFromStart(toDistance: total, total: total)
        var scale = 1.0
        if let enroute = flightPlan.enrouteDuration, modelled > 0 {
            // Only trust the filed time if it is within a plausible factor of the model.
            let ratio = enroute / modelled
            if ratio > 0.5 && ratio < 2 { scale = ratio }
        }
        self.init(path: route) { d in
            departure.addingTimeInterval(profile.timeFromStart(toDistance: d, total: total) * scale)
        }
    }

    /// Live timeline for an airborne aircraft. The timed path starts at the aircraft position and continues
    /// along the remaining route. If `estimate` has a touchdown time the timeline is scaled to end there.
    public init(route: ResolvedRoute, aircraft position: GeoPoint, groundspeedKt: Double, filedTASKt: Double?,
                now: Date, estimate: ETAEstimate? = nil) {
        var remainingWaypoints = [Waypoint(ident: "AIRCRAFT", kind: .aircraft, point: position)]
        if let pos = route.project(position), pos.offRouteNM <= ETACalculator.offRouteThresholdNM {
            remainingWaypoints += route.waypoints[(pos.legIndex + 1)...]
        } else if let last = route.waypoints.last {
            remainingWaypoints.append(last)
        }
        let path = ResolvedRoute(waypoints: RouteResolver.deduplicated(remainingWaypoints),
                                 isGreatCircleFallback: route.isGreatCircleFallback)
        let total = path.totalDistanceNM
        let toGo: (Double) -> TimeInterval = { remaining in
            ETACalculator.timeToGo(remaining: remaining, groundspeedKt: groundspeedKt, filedTASKt: filedTASKt)
                ?? remaining / max(100, groundspeedKt) * 3600
        }
        let fullTime = toGo(total)
        var scale = 1.0
        if let touchdown = estimate?.touchdown, fullTime > 0 {
            let target = touchdown.timeIntervalSince(now)
            if target > 0 { scale = target / fullTime }
        }
        self.init(path: path) { d in
            now.addingTimeInterval((fullTime - toGo(max(0, total - d))) * scale)
        }
    }

    /// Estimated time at `distanceNM` from the start of `path`.
    public func time(atDistanceNM d: Double) -> Date? {
        guard let first = samples.first, let last = samples.last else { return nil }
        if d <= first.distanceNM { return first.time }
        if d >= last.distanceNM { return last.time }
        var lo = 0, hi = samples.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if samples[mid].distanceNM <= d { lo = mid } else { hi = mid }
        }
        let a = samples[lo], b = samples[hi]
        let f = (d - a.distanceNM) / max(1e-9, b.distanceNM - a.distanceNM)
        return a.time.addingTimeInterval(b.time.timeIntervalSince(a.time) * f)
    }

    /// Distance along `path` reached at `date`, or `nil` outside the timeline.
    public func distance(at date: Date) -> Double? {
        guard let first = samples.first, let last = samples.last, date >= first.time, date <= last.time else {
            return nil
        }
        var lo = 0, hi = samples.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if samples[mid].time <= date { lo = mid } else { hi = mid }
        }
        let a = samples[lo], b = samples[hi]
        let span = b.time.timeIntervalSince(a.time)
        guard span > 0 else { return a.distanceNM }
        return a.distanceNM + (b.distanceNM - a.distanceNM) * date.timeIntervalSince(a.time) / span
    }

    /// Estimated position at `date`, or `nil` outside the timeline.
    public func point(at date: Date) -> GeoPoint? {
        distance(at: date).flatMap { path.point(atDistanceNM: $0) }
    }
}
