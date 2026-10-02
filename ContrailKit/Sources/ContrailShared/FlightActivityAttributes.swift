#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

/// Live Activity / Dynamic Island for a followed flight.
/// Updated by the app from the feed (foreground + background refresh), never more often than the
/// feed itself (15 s). Ends automatically when the flight arrives or disconnects.
public struct FlightActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var phase: String
        public var phaseSymbol: String
        public var altitudeFt: Int
        public var groundspeedKt: Int
        /// 0…1
        public var progress: Double
        public var eta: Date?
        public var remainingNM: Double
        public var updatedAt: Date
        public var isStale: Bool

        public init(phase: String, phaseSymbol: String, altitudeFt: Int, groundspeedKt: Int, progress: Double,
                    eta: Date?, remainingNM: Double, updatedAt: Date = .now, isStale: Bool = false) {
            self.phase = phase
            self.phaseSymbol = phaseSymbol
            self.altitudeFt = altitudeFt
            self.groundspeedKt = groundspeedKt
            self.progress = progress
            self.eta = eta
            self.remainingNM = remainingNM
            self.updatedAt = updatedAt
            self.isStale = isStale
        }
    }

    public var callsign: String
    public var departure: String
    public var arrival: String
    public var aircraftType: String
    public var cid: Int

    public init(callsign: String, departure: String, arrival: String, aircraftType: String, cid: Int) {
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.aircraftType = aircraftType
        self.cid = cid
    }
}
#endif
