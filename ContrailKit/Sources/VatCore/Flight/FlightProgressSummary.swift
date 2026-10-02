import Foundation

/// Compact flight state for widgets, Live Activities and the watch.
public struct FlightProgressSummary: Codable, Sendable, Hashable {
    public var callsign: String
    public var departure: String
    public var arrival: String
    public var phase: FlightPhase
    public var altitudeFt: Int
    public var groundspeedKt: Int
    /// 0…1 by distance.
    public var progress: Double
    /// Estimated touchdown.
    public var eta: Date?
    public var remainingNM: Double

    public init(callsign: String, departure: String, arrival: String, phase: FlightPhase, altitudeFt: Int,
                groundspeedKt: Int, progress: Double, eta: Date?, remainingNM: Double) {
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.phase = phase
        self.altitudeFt = altitudeFt
        self.groundspeedKt = groundspeedKt
        self.progress = progress
        self.eta = eta
        self.remainingNM = remainingNM
    }

    public init(pilot: Pilot, phase: FlightPhase, estimate: ETAEstimate) {
        self.init(
            callsign: pilot.callsign, departure: pilot.flightPlan?.departure ?? "",
            arrival: pilot.flightPlan?.arrival ?? "", phase: phase, altitudeFt: pilot.altitude,
            groundspeedKt: pilot.groundspeed, progress: estimate.progress, eta: estimate.touchdown,
            remainingNM: estimate.remainingDistanceNM
        )
    }

    /// Runs phase detection and ETA for `pilot` in one go.
    /// - Parameters:
    ///   - route: pre-resolved route (resolve once per flight plan revision and cache it); when `nil`
    ///     a great circle departure → arrival is used.
    ///   - verticalRateFpm: typically `FlightTrack.verticalRateFpm()`.
    public static func make(
        pilot: Pilot, departure: Airport?, arrival: Airport?, route: ResolvedRoute? = nil,
        verticalRateFpm: Double? = nil, now: Date
    ) -> FlightProgressSummary {
        let phase = FlightPhaseDetector.phase(
            pilot: pilot, departure: departure, arrival: arrival, verticalRateFpm: verticalRateFpm,
            filedCruiseFt: pilot.flightPlan?.cruiseAltitudeFeet
        )
        let estimate = ETACalculator.estimate(
            pilot: pilot, route: route, arrival: arrival, phase: phase, now: now, departure: departure
        )
        return FlightProgressSummary(pilot: pilot, phase: phase, estimate: estimate)
    }
}
