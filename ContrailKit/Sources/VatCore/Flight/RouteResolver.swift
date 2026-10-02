import Foundation

/// A route resolved to coordinates.
public struct ResolvedRoute: Codable, Sendable, Hashable {
    public let waypoints: [Waypoint]
    public let totalDistanceNM: Double
    /// True when no intermediate point could be resolved and the route is a plain great circle.
    public var isGreatCircleFallback: Bool
    /// Identifiers that could not be resolved (unknown fixes, airways are not listed).
    public var unresolvedIdents: [String]
    /// Cumulative distance from the first waypoint to each waypoint (same count as `waypoints`).
    public let cumulativeDistanceNM: [Double]

    public init(waypoints: [Waypoint], isGreatCircleFallback: Bool = false, unresolvedIdents: [String] = []) {
        self.waypoints = waypoints
        self.isGreatCircleFallback = isGreatCircleFallback
        self.unresolvedIdents = unresolvedIdents
        var cumulative: [Double] = []
        cumulative.reserveCapacity(waypoints.count)
        var total = 0.0
        for (i, w) in waypoints.enumerated() {
            if i > 0 { total += waypoints[i - 1].point.distance(to: w.point) }
            cumulative.append(total)
        }
        self.cumulativeDistanceNM = cumulative
        self.totalDistanceNM = total
    }

    /// Plain great circle between two points.
    public static func greatCircle(from: Waypoint, to: Waypoint) -> ResolvedRoute {
        ResolvedRoute(waypoints: [from, to], isGreatCircleFallback: true)
    }

    public var start: GeoPoint? { waypoints.first?.point }
    public var end: GeoPoint? { waypoints.last?.point }
    public var legCount: Int { max(0, waypoints.count - 1) }

    /// Points along the route with great-circle segments no longer than `maxSegmentNM`, for drawing.
    public func densifiedPath(maxSegmentNM: Double = 50) -> [GeoPoint] {
        guard let first = waypoints.first else { return [] }
        var result = [first.point]
        for i in 1..<max(1, waypoints.count) {
            let path = waypoints[i - 1].point.greatCirclePath(to: waypoints[i].point, maxSegmentNM: max(1, maxSegmentNM))
            result.append(contentsOf: path.dropFirst())
        }
        return result
    }

    /// Point at `distanceNM` from the start along the route (clamped to the route).
    public func point(atDistanceNM distanceNM: Double) -> GeoPoint? {
        guard let first = waypoints.first else { return nil }
        guard waypoints.count > 1, distanceNM > 0 else { return first.point }
        if distanceNM >= totalDistanceNM { return waypoints[waypoints.count - 1].point }
        let leg = legIndex(atDistanceNM: distanceNM)
        let a = waypoints[leg].point, b = waypoints[leg + 1].point
        let len = cumulativeDistanceNM[leg + 1] - cumulativeDistanceNM[leg]
        guard len > 1e-9 else { return a }
        return a.intermediate(to: b, fraction: (distanceNM - cumulativeDistanceNM[leg]) / len)
    }

    /// Index of the leg (from `waypoints[i]` to `waypoints[i+1]`) containing `distanceNM`.
    public func legIndex(atDistanceNM d: Double) -> Int {
        guard waypoints.count > 2 else { return 0 }
        var lo = 0, hi = waypoints.count - 2
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if cumulativeDistanceNM[mid] <= d { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// Projects `point` on the route. Ties within 1 NM prefer later legs, so an aircraft is never
    /// placed on an earlier leg than the one it is flying. `minimumLegIndex` can enforce monotonic progress.
    public func project(_ point: GeoPoint, minimumLegIndex: Int = 0) -> RoutePosition? {
        guard waypoints.count >= 2 else { return nil }
        var best: RoutePosition?
        for i in max(0, min(minimumLegIndex, waypoints.count - 2))..<(waypoints.count - 1) {
            let a = waypoints[i].point, b = waypoints[i + 1].point
            let len = cumulativeDistanceNM[i + 1] - cumulativeDistanceNM[i]
            let along: Double
            let projected: GeoPoint
            if len < 1e-6 {
                along = 0
                projected = a
            } else {
                along = min(max(point.alongTrackDistance(from: a, to: b), 0), len)
                projected = a.intermediate(to: b, fraction: along / len)
            }
            let offset = point.distance(to: projected)
            let remaining = point.distance(to: b) + (totalDistanceNM - cumulativeDistanceNM[i + 1])
            let candidate = RoutePosition(
                legIndex: i, distanceAlongNM: cumulativeDistanceNM[i] + along, offRouteNM: offset,
                remainingNM: remaining
            )
            if let current = best {
                if offset <= current.offRouteNM + 1 { best = candidate }
            } else {
                best = candidate
            }
        }
        return best
    }
}

/// Position of an aircraft relative to a resolved route.
public struct RoutePosition: Codable, Sendable, Hashable {
    /// Active leg, from `waypoints[legIndex]` to `waypoints[legIndex + 1]`.
    public var legIndex: Int
    /// Distance from the route start to the projection of the aircraft.
    public var distanceAlongNM: Double
    /// Distance from the aircraft to the route.
    public var offRouteNM: Double
    /// Distance to fly: aircraft → next waypoint → … → last waypoint.
    public var remainingNM: Double
}

/// Resolves a filed route (or a SimBrief navlog) to coordinates.
///
/// Rules (DECISIONS D-014): airways are skipped (no licensed data), so the path goes direct between
/// resolved points; explicit coordinates are always accepted; ambiguous identifiers choose the candidate
/// nearest to the previous point; a candidate is rejected if it is more than `maxLegNM` from the previous
/// point or if the detour previous → candidate → arrival exceeds `backtrackFactor` × the direct distance
/// (with a `backtrackSlackNM` allowance for short remaining legs).
public struct RouteResolver: Sendable {
    public var lookup: any WaypointLookup
    public var maxLegNM: Double
    public var backtrackFactor: Double
    public var backtrackSlackNM: Double

    public init(lookup: any WaypointLookup, maxLegNM: Double = 1_500, backtrackFactor: Double = 2.5,
                backtrackSlackNM: Double = 150) {
        self.lookup = lookup
        self.maxLegNM = maxLegNM
        self.backtrackFactor = backtrackFactor
        self.backtrackSlackNM = backtrackSlackNM
    }

    public func resolve(
        flightPlan: FlightPlan?, navlog: [Waypoint]? = nil, departure: Airport?, arrival: Airport?
    ) -> ResolvedRoute {
        let depWP = departure.map(Self.waypoint(for:))
        let arrWP = arrival.map(Self.waypoint(for:))

        if let navlog, !navlog.isEmpty {
            var points = navlog.filter { $0.point.isValid }
            if let depWP, let first = points.first, first.ident != depWP.ident, first.point.distance(to: depWP.point) > 1 {
                points.insert(depWP, at: 0)
            }
            if let arrWP, let last = points.last, last.ident != arrWP.ident, last.point.distance(to: arrWP.point) > 1 {
                points.append(arrWP)
            }
            return ResolvedRoute(waypoints: Self.deduplicated(points))
        }

        let tokens = RouteParser.parse(flightPlan?.route ?? "")
        return resolve(tokens: tokens, departure: depWP, arrival: arrWP)
    }

    public func resolve(tokens: [RouteToken], departure: Waypoint?, arrival: Waypoint?) -> ResolvedRoute {
        var points: [Waypoint] = []
        if let departure { points.append(departure) }
        var unresolved: [String] = []
        var intermediate = 0
        for token in tokens {
            switch token {
            case .coordinate(let p):
                points.append(Waypoint(ident: RouteParser.format(p), kind: .coordinate, point: p))
                intermediate += 1
            case .waypoint(let ident):
                if let departure, ident == departure.ident { continue }
                if let arrival, ident == arrival.ident { continue }
                if let wp = choose(ident: ident, previous: points.last?.point, arrival: arrival?.point) {
                    points.append(wp)
                    intermediate += 1
                } else {
                    unresolved.append(ident)
                }
            case .airway, .direct, .sid, .star, .speedLevel:
                continue
            }
        }
        if let arrival { points.append(arrival) }
        points = Self.deduplicated(points)
        return ResolvedRoute(waypoints: points, isGreatCircleFallback: intermediate == 0, unresolvedIdents: unresolved)
    }

    func choose(ident: String, previous: GeoPoint?, arrival: GeoPoint?) -> Waypoint? {
        let candidates = lookup.candidates(for: ident).filter { $0.point.isValid }
        guard !candidates.isEmpty else { return nil }
        guard let reference = previous ?? arrival else {
            return candidates.count == 1 ? candidates[0] : nil
        }
        let sorted = candidates.sorted { reference.distance(to: $0.point) < reference.distance(to: $1.point) }
        for c in sorted {
            if let previous {
                let leg = previous.distance(to: c.point)
                if leg > maxLegNM { continue }
                if let arrival {
                    let direct = previous.distance(to: arrival)
                    let detour = leg + c.point.distance(to: arrival)
                    if detour > max(backtrackFactor * direct, direct + backtrackSlackNM) { continue }
                }
            }
            return c
        }
        return nil
    }

    static func deduplicated(_ points: [Waypoint]) -> [Waypoint] {
        var result: [Waypoint] = []
        for p in points {
            if let last = result.last, last.point.distance(to: p.point) < 0.5 { continue }
            result.append(p)
        }
        return result
    }

    public static func waypoint(for airport: Airport) -> Waypoint {
        Waypoint(ident: airport.icao, name: airport.name, kind: .airport, point: airport.position)
    }
}

/// A trivial in-memory `WaypointLookup` (tests, previews, SimBrief navlog fixes).
public struct InMemoryWaypointLookup: WaypointLookup {
    public var byIdent: [String: [Waypoint]]

    public init(_ waypoints: [Waypoint]) {
        byIdent = Dictionary(grouping: waypoints, by: { $0.ident.uppercased() })
    }

    public init(airports: [Airport], navaids: [Navaid] = []) {
        var all = airports.map(RouteResolver.waypoint(for:))
        all += navaids.map { Waypoint(ident: $0.ident, name: $0.name, kind: .navaid, point: $0.position) }
        self.init(all)
    }

    public func candidates(for ident: String) -> [Waypoint] { byIdent[ident.uppercased()] ?? [] }
}
