import Foundation

/// Phase of a flight, inferred from position, speed, altitude and the filed plan.
public enum FlightPhase: String, Codable, Sendable, Hashable, CaseIterable {
    /// At the gate at the departure airport (GS < 1 kt).
    case preflight
    case taxiOut
    /// Take-off roll or initial climb below 1500 ft AGL near the departure airport.
    case takeoff
    case climb
    case cruise
    case descent
    case approach
    /// On the ground near the arrival airport, decelerating or taxiing in.
    case landed
    /// Parked at the arrival airport (GS < 1 kt).
    case arrived
    case unknown

    /// SF Symbol name.
    public var symbolName: String {
        switch self {
        case .preflight: "parkingsign.circle"
        case .taxiOut: "arrow.triangle.turn.up.right.circle"
        case .takeoff: "airplane.departure"
        case .climb: "arrow.up.right.circle"
        case .cruise: "airplane"
        case .descent: "arrow.down.right.circle"
        case .approach: "airplane.arrival"
        case .landed: "road.lanes"
        case .arrived: "checkmark.circle"
        case .unknown: "questionmark.circle"
        }
    }

    /// English title (the app localises via its string catalog using `rawValue` keys).
    public var title: String {
        switch self {
        case .preflight: "Preflight"
        case .taxiOut: "Taxi out"
        case .takeoff: "Takeoff"
        case .climb: "Climb"
        case .cruise: "Cruise"
        case .descent: "Descent"
        case .approach: "Approach"
        case .landed: "Landed"
        case .arrived: "Arrived"
        case .unknown: "Unknown"
        }
    }

    public var isOnGround: Bool { [.preflight, .taxiOut, .landed, .arrived].contains(self) }
    public var isAirborne: Bool { [.takeoff, .climb, .cruise, .descent, .approach].contains(self) }
    /// Before take-off.
    public var isBeforeDeparture: Bool { self == .preflight || self == .taxiOut }
    public var isFinished: Bool { self == .landed || self == .arrived }
}

/// Coarse ground state used by airport boards (departures/arrivals lists).
public enum GroundState: String, Codable, Sendable, Hashable {
    case atGate, taxiing, airborne

    /// - Parameter airportElevationFt: elevation of the nearest airport when known.
    public static func of(pilot: Pilot, airportElevationFt: Int? = nil) -> GroundState {
        let agl = pilot.altitude - (airportElevationFt ?? 0)
        let onGround = (agl < 200 && pilot.groundspeed < 50) || (airportElevationFt != nil && pilot.groundspeed < 35)
            || (airportElevationFt == nil && pilot.groundspeed < 35 && pilot.altitude < 15_000)
        guard onGround else { return .airborne }
        return pilot.groundspeed < 1 ? .atGate : .taxiing
    }

    public var symbolName: String {
        switch self {
        case .atGate: "parkingsign.circle"
        case .taxiing: "arrow.triangle.turn.up.right.circle"
        case .airborne: "airplane"
        }
    }
}

/// Heuristic flight phase detection.
///
/// Rules (all distances NM, altitudes ft, speeds kt):
/// - **On ground** when AGL < 200 and GS < 50, AGL < 50 near a known airport (take-off/landing roll), or
///   GS < 35 within 10 NM of a known airport (or anywhere below 15000 ft if no airport is known). AGL uses
///   the elevation of the closest of departure/arrival.
/// - On ground near the departure: GS < 1 → preflight, < 40 → taxi out, else take-off roll.
/// - On ground near the arrival (or far from the departure after a diversion): GS < 1 → arrived, else landed.
/// - Airborne: approach when < 25 NM from arrival below 5000 AGL and not climbing; take-off below 1500 AGL
///   within 8 NM of the departure; cruise when within ±1500 ft of the filed level or above FL100 with
///   |VS| < 300 fpm; otherwise climb/descent by vertical rate, or by position along the route.
public enum FlightPhaseDetector {
    public static let nearAirportNM = 10.0

    public static func phase(
        pilot: Pilot, departure: Airport?, arrival: Airport?, verticalRateFpm: Double?, filedCruiseFt: Int?
    ) -> FlightPhase {
        let p = pilot.position
        let gs = pilot.groundspeed
        let dDep = departure.map { $0.position.distance(to: p) }
        let dArr = arrival.map { $0.position.distance(to: p) }

        // Elevation reference: the closest known airport.
        var reference: Airport?
        switch (dDep, dArr) {
        case let (d?, a?): reference = d <= a ? departure : arrival
        case (.some, nil): reference = departure
        case (nil, .some): reference = arrival
        default: reference = nil
        }
        let refDistance = reference.map { $0.position.distance(to: p) }
        let agl = pilot.altitude - (reference?.elevationFt ?? 0)
        let nearAnyAirport = (refDistance ?? .infinity) <= nearAirportNM

        let onGround: Bool
        if agl < 200 && gs < 50 {
            onGround = true
        } else if agl < 50 && gs < 200 && nearAnyAirport {
            onGround = true // take-off or landing roll
        } else if gs < 35 && (nearAnyAirport || (reference == nil && pilot.altitude < 15_000)) {
            onGround = true
        } else {
            onGround = false
        }

        if onGround {
            return groundPhase(gs: gs, dDep: dDep, dArr: dArr, sameAirport: departure?.icao == arrival?.icao)
        }
        return airbornePhase(
            pilot: pilot, agl: agl, dDep: dDep, dArr: dArr, arrivalElevation: arrival?.elevationFt,
            verticalRateFpm: verticalRateFpm, filedCruiseFt: filedCruiseFt
        )
    }

    /// Convenience using the pilot's own flight plan and a lookup.
    public static func phase(pilot: Pilot, airports: (String) -> Airport?, verticalRateFpm: Double? = nil) -> FlightPhase {
        let fp = pilot.flightPlan
        return phase(
            pilot: pilot,
            departure: fp.flatMap { $0.departure.isEmpty ? nil : airports($0.departure) },
            arrival: fp.flatMap { $0.arrival.isEmpty ? nil : airports($0.arrival) },
            verticalRateFpm: verticalRateFpm, filedCruiseFt: fp?.cruiseAltitudeFeet
        )
    }

    /// True when the pilot is on the ground at/near one of `airports` (or anywhere at very low speed).
    public static func isOnGround(pilot: Pilot, nearby airports: [Airport]) -> Bool {
        let p = pilot.position
        let nearest = airports.min { $0.position.distance(to: p) < $1.position.distance(to: p) }
        let near = nearest.map { $0.position.distance(to: p) <= nearAirportNM } ?? false
        let agl = pilot.altitude - (nearest?.elevationFt ?? 0)
        if agl < 200 && pilot.groundspeed < 50 { return true }
        if agl < 50 && pilot.groundspeed < 200 && near { return true }
        if pilot.groundspeed < 35 && (near || (nearest == nil && pilot.altitude < 15_000)) { return true }
        return false
    }

    private static func groundPhase(gs: Int, dDep: Double?, dArr: Double?, sameAirport: Bool) -> FlightPhase {
        enum Side { case departure, arrival }
        let side: Side
        switch (dDep, dArr) {
        case let (d?, a?):
            if sameAirport { side = .departure }
            else if a < d && a <= nearAirportNM { side = .arrival }
            else if d <= nearAirportNM { side = .departure }
            else { side = d > 30 ? .arrival : .departure } // diverted / landed elsewhere
        case let (d?, nil): side = d > 30 ? .arrival : .departure
        case let (nil, a?): side = a <= nearAirportNM ? .arrival : .departure
        default: side = .departure
        }
        switch side {
        case .departure:
            if gs < 1 { return .preflight }
            return gs < 40 ? .taxiOut : .takeoff
        case .arrival:
            return gs < 1 ? .arrived : .landed
        }
    }

    private static func airbornePhase(
        pilot: Pilot, agl: Int, dDep: Double?, dArr: Double?, arrivalElevation: Int?,
        verticalRateFpm vs: Double?, filedCruiseFt: Int?
    ) -> FlightPhase {
        let alt = pilot.altitude
        let climbing = (vs ?? 0) > 300
        let descending = (vs ?? 0) < -300
        let aglArrival = alt - (arrivalElevation ?? 0)

        if let a = dArr, a < 25, aglArrival < 5_000, !((vs ?? 0) > 500), dDep.map({ $0 > 8 }) ?? true {
            return .approach
        }
        if let d = dDep, d < 8, agl < 1_500, !descending { return .takeoff }

        let inFiledBand = filedCruiseFt.map { $0 > 0 && abs(alt - $0) <= 1_500 } ?? false
        if inFiledBand && !(climbing && (vs ?? 0) > 1_000) && !(descending && (vs ?? 0) < -1_000) {
            return .cruise
        }
        if let vs {
            if alt > 10_000 && abs(vs) < 300 { return .cruise }
            if climbing { return .climb }
            if descending { return (dArr ?? .infinity) < 40 ? .approach : .descent }
            // Level below FL100 outside the filed band.
            return levelLowPhase(dDep: dDep, dArr: dArr)
        }
        // No vertical rate: decide from position along the route.
        if let d = dDep, let a = dArr {
            if alt > 10_000, filedCruiseFt == nil { return .cruise }
            return d < a ? .climb : .descent
        }
        return alt > 10_000 ? .cruise : .unknown
    }

    private static func levelLowPhase(dDep: Double?, dArr: Double?) -> FlightPhase {
        guard let d = dDep, let a = dArr else { return .cruise }
        if a < 40 { return .approach }
        if d < 40 { return .climb }
        return .cruise
    }
}
