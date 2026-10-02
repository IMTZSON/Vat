import Foundation

/// Estimated time of arrival for a flight.
public struct ETAEstimate: Codable, Sendable, Hashable {
    public enum Confidence: String, Codable, Sendable, Hashable, Comparable {
        case low, medium, high

        var order: Int {
            switch self {
            case .low: 0
            case .medium: 1
            case .high: 2
            }
        }

        public static func < (lhs: Confidence, rhs: Confidence) -> Bool { lhs.order < rhs.order }
    }

    public enum Method: String, Codable, Sendable, Hashable {
        /// On ground before departure: filed departure time + filed en-route time.
        case filedSchedule
        /// Along the resolved route.
        case route
        /// Great circle from the current position (no route, or route unresolved).
        case greatCircle
        /// Far from the filed route (diversion, vectors): great circle from the current position.
        case offRoute
        /// Already on the ground at the destination.
        case arrived
        /// Not enough information.
        case unavailable
    }

    /// Estimated touchdown (landing) time.
    public var touchdown: Date?
    /// Estimated on-block time (touchdown + taxi-in allowance).
    public var onBlock: Date?
    public var remainingDistanceNM: Double
    /// 0…1 by distance.
    public var progress: Double
    public var confidence: Confidence
    public var method: Method
    /// Active route leg (method `.route`/`.greatCircle` with a route). Pass it back as `minimumLegIndex` on
    /// the next update so the projection never moves backwards along the route.
    public var legIndex: Int?

    public init(touchdown: Date?, onBlock: Date?, remainingDistanceNM: Double, progress: Double,
                confidence: Confidence, method: Method, legIndex: Int? = nil) {
        self.touchdown = touchdown
        self.onBlock = onBlock
        self.remainingDistanceNM = remainingDistanceNM
        self.progress = progress
        self.confidence = confidence
        self.method = method
        self.legIndex = legIndex
    }

    public static let unavailable = ETAEstimate(touchdown: nil, onBlock: nil, remainingDistanceNM: 0, progress: 0,
                                                confidence: .low, method: .unavailable)

    /// Time remaining to touchdown from `now`.
    public func timeRemaining(now: Date) -> TimeInterval? { touchdown.map { max(0, $0.timeIntervalSince(now)) } }
}

/// ETA computation (pure, deterministic: `now` is injected).
///
/// Speed model: see `SpeedProfile`. Cruise speed = max(GS, 0.75 × filed TAS); the last 120 NM follow a
/// descent/approach profile (≈280 → 180 kt for jets). On-block = touchdown + `taxiInAllowance` (3 min).
public enum ETACalculator {
    public static let taxiInAllowance: TimeInterval = 180
    /// Beyond this distance from the route the aircraft is considered off-route (diverting/vectored).
    public static let offRouteThresholdNM = 150.0

    /// - Parameter minimumLegIndex: the `legIndex` of the previous estimate for the same flight, so the
    ///   aircraft is never projected on an earlier leg (routes that double back on themselves).
    public static func estimate(
        pilot: Pilot, route: ResolvedRoute?, arrival: Airport?, phase: FlightPhase, now: Date,
        departure: Airport? = nil, minimumLegIndex: Int = 0
    ) -> ETAEstimate {
        guard let arrival else { return .unavailable }
        let position = pilot.position
        let fp = pilot.flightPlan
        let filedTAS = fp?.cruiseSpeedKnots.map(Double.init)
        let directToArrival = position.distance(to: arrival.position)
        let usableRoute = route.flatMap { $0.waypoints.count >= 2 ? $0 : nil }
        let totalPlanned = usableRoute?.totalDistanceNM
            ?? departure.map { $0.position.distance(to: arrival.position) }

        // Arrived / landed.
        if phase == .arrived || phase == .landed {
            let onBlock: Date? = phase == .landed ? now.addingTimeInterval(taxiInAllowance) : nil
            return ETAEstimate(touchdown: nil, onBlock: onBlock, remainingDistanceNM: directToArrival, progress: 1,
                               confidence: .high, method: .arrived)
        }

        // Remaining distance.
        var remaining = directToArrival
        var method = ETAEstimate.Method.greatCircle
        var legIndex: Int?
        if let r = usableRoute, let pos = r.project(position, minimumLegIndex: minimumLegIndex) {
            if pos.offRouteNM > offRouteThresholdNM {
                method = .offRoute
            } else {
                remaining = pos.remainingNM
                legIndex = pos.legIndex
                method = r.isGreatCircleFallback ? .greatCircle : .route
            }
        }

        let progress: Double = {
            if phase.isBeforeDeparture { return 0 }
            guard let total = totalPlanned, total > 0 else { return 0 }
            let reference = method == .offRoute ? max(total, remaining) : total
            return min(1, max(0, 1 - remaining / reference))
        }()

        // Before departure: filed schedule.
        if phase.isBeforeDeparture {
            guard let fp, let enroute = fp.enrouteDuration else {
                return ETAEstimate(touchdown: nil, onBlock: nil, remainingDistanceNM: remaining, progress: 0,
                                   confidence: .low, method: .unavailable)
            }
            let filedDeparture = fp.departureDate(relativeTo: now) ?? now
            let departure = max(filedDeparture, now)
            let touchdown = departure.addingTimeInterval(enroute)
            return ETAEstimate(touchdown: touchdown, onBlock: touchdown.addingTimeInterval(taxiInAllowance),
                               remainingDistanceNM: remaining, progress: 0, confidence: .low, method: .filedSchedule)
        }

        // Airborne (or unknown): speed model.
        let gs = Double(pilot.groundspeed)
        var cruise = max(gs, 0.75 * (filedTAS ?? 0))
        if cruise < 50 {
            // GS unusable (paused / slewing) and no filed TAS: cannot estimate.
            guard let tas = filedTAS, tas >= 50 else {
                return ETAEstimate(touchdown: nil, onBlock: nil, remainingDistanceNM: remaining, progress: progress,
                                   confidence: .low, method: .unavailable)
            }
            cruise = tas
        }
        let profile = SpeedProfile(cruiseKt: cruise)
        let seconds = profile.timeToGo(remaining: remaining, currentSpeedKt: gs)
        let touchdown = now.addingTimeInterval(seconds)

        var confidence: ETAEstimate.Confidence
        switch method {
        case .route: confidence = [.cruise, .descent, .approach].contains(phase) ? .high : .medium
        case .greatCircle: confidence = .medium
        default: confidence = .low
        }
        if gs < 50 { confidence = .low }
        return ETAEstimate(touchdown: touchdown, onBlock: touchdown.addingTimeInterval(taxiInAllowance),
                           remainingDistanceNM: remaining, progress: progress, confidence: confidence, method: method,
                           legIndex: legIndex)
    }

    /// Seconds to fly `remaining` NM for an airborne aircraft (exposed for timelines).
    public static func timeToGo(remaining: Double, groundspeedKt: Double, filedTASKt: Double?) -> TimeInterval? {
        var cruise = max(groundspeedKt, 0.75 * (filedTASKt ?? 0))
        if cruise < 50 {
            guard let tas = filedTASKt, tas >= 50 else { return nil }
            cruise = tas
        }
        return SpeedProfile(cruiseKt: cruise).timeToGo(remaining: remaining, currentSpeedKt: groundspeedKt)
    }
}
