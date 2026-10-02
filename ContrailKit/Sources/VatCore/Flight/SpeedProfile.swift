import Foundation

/// Simple ground-speed model shared by ETA and planning (no wind).
///
/// - Climb: linear from `climbStartKt` (250 kt, or 80 % of cruise for slow aircraft) to cruise over the
///   first `climbNM` (150 NM).
/// - Cruise: constant `cruiseKt`.
/// - Descent/approach: linear from `descentStartKt` (min(280, cruise)) to `descentEndKt` (min(180, 65 %
///   of cruise)) over the last `descentNM` (120 NM); average ≈ 226 kt for jets.
/// Routes shorter than climb + descent scale both phases proportionally.
public struct SpeedProfile: Codable, Sendable, Hashable {
    public var cruiseKt: Double
    public var climbStartKt: Double
    public var descentStartKt: Double
    public var descentEndKt: Double
    public var climbNM: Double
    public var descentNM: Double

    public init(cruiseKt: Double, climbNM: Double = 150, descentNM: Double = 120) {
        let cruise = max(40, cruiseKt)
        self.cruiseKt = cruise
        self.climbStartKt = min(250, cruise * 0.8)
        self.descentStartKt = min(280, cruise)
        self.descentEndKt = min(180, cruise * 0.65)
        self.climbNM = climbNM
        self.descentNM = descentNM
    }

    /// Time (seconds) to cover `distance` NM while speed varies linearly from `v0` to `v1`.
    static func linearTime(distance: Double, v0: Double, v1: Double) -> TimeInterval {
        guard distance > 0 else { return 0 }
        let a = max(1, v0), b = max(1, v1)
        if abs(b - a) < 1e-6 { return distance / a * 3600 }
        return distance / (b - a) * log(b / a) * 3600
    }

    /// Phase lengths for a route of `total` NM.
    func phases(total: Double) -> (climb: Double, descent: Double) {
        let sum = climbNM + descentNM
        guard total < sum, sum > 0 else { return (climbNM, descentNM) }
        return (total * climbNM / sum, total * descentNM / sum)
    }

    /// Planned speed at `x` NM from the start of a `total` NM route.
    public func speed(atDistance x: Double, total: Double) -> Double {
        let (c, d) = phases(total: total)
        if x < c, c > 0 { return climbStartKt + (cruiseKt - climbStartKt) * x / c }
        if x > total - d, d > 0 {
            let toGo = max(0, total - x)
            return descentEndKt + (descentStartKt - descentEndKt) * toGo / d
        }
        return cruiseKt
    }

    /// Time (seconds) from the start of a `total` NM route to `x` NM along it.
    public func timeFromStart(toDistance x: Double, total: Double) -> TimeInterval {
        let x = min(max(0, x), total)
        let (c, d) = phases(total: total)
        var t = 0.0
        // Climb.
        let climbPart = min(x, c)
        if climbPart > 0 {
            t += Self.linearTime(distance: climbPart, v0: climbStartKt,
                                 v1: speed(atDistance: climbPart, total: total))
        }
        // Cruise.
        let cruiseStart = c, cruiseEnd = total - d
        let cruisePart = max(0, min(x, cruiseEnd) - cruiseStart)
        t += cruisePart / cruiseKt * 3600
        // Descent.
        if x > cruiseEnd, d > 0 {
            let from = max(cruiseEnd, c)
            t += Self.linearTime(distance: x - from, v0: speed(atDistance: from + 1e-9, total: total),
                                 v1: speed(atDistance: x, total: total))
        }
        return t
    }

    /// Time (seconds) to fly the last `remaining` NM of a flight currently at `currentSpeedKt`, used by the
    /// ETA: cruise at `cruiseKt` until `descentNM` to go, then the descent profile. When already inside the
    /// descent zone the profile starts from the lower of the profile speed and the current speed.
    public func timeToGo(remaining: Double, currentSpeedKt: Double?) -> TimeInterval {
        guard remaining > 0 else { return 0 }
        if remaining > descentNM {
            return (remaining - descentNM) / cruiseKt * 3600
                + Self.linearTime(distance: descentNM, v0: descentStartKt, v1: descentEndKt)
        }
        let profileSpeed = descentEndKt + (descentStartKt - descentEndKt) * remaining / max(1, descentNM)
        var v0 = profileSpeed
        if let current = currentSpeedKt, current > 50 { v0 = max(descentEndKt, min(profileSpeed, current)) }
        return Self.linearTime(distance: remaining, v0: v0, v1: descentEndKt)
    }
}
