import Foundation

/// Minimal network snapshot for the time machine. **No names** are stored (DECISIONS D-020).
public struct CompactSnapshot: Codable, Sendable, Hashable {
    public var timestamp: Date
    public var pilots: [CompactPilot]
    public var controllers: [CompactController]

    public init(timestamp: Date, pilots: [CompactPilot] = [], controllers: [CompactController] = []) {
        self.timestamp = timestamp
        self.pilots = pilots
        self.controllers = controllers
    }

    /// Builds a snapshot from a decoded feed. Controllers include ATIS stations; observers are skipped.
    public init(snapshot feed: VatsimFeed, at timestamp: Date) {
        self.timestamp = timestamp
        pilots = feed.pilots.map(CompactPilot.init(pilot:))
        controllers = (feed.controllers + feed.atis)
            .filter { $0.facility != .observer || $0.position == .atis }
            .map(CompactController.init(controller:))
    }
}

public struct CompactPilot: Codable, Sendable, Hashable, Identifiable {
    public var cid: Int
    public var callsign: String
    public var lat: Float
    public var lon: Float
    /// Feet MSL.
    public var altitude: Int32
    public var groundspeed: Int16
    public var heading: Int16
    public var departure: String
    public var arrival: String
    public var aircraftType: String

    public var id: String { callsign }
    public var position: GeoPoint { GeoPoint(latitude: Double(lat), longitude: Double(lon)) }

    public init(cid: Int, callsign: String, lat: Float, lon: Float, altitude: Int32, groundspeed: Int16,
                heading: Int16, departure: String = "", arrival: String = "", aircraftType: String = "") {
        self.cid = cid
        self.callsign = callsign
        self.lat = lat
        self.lon = lon
        self.altitude = altitude
        self.groundspeed = groundspeed
        self.heading = heading
        self.departure = departure
        self.arrival = arrival
        self.aircraftType = aircraftType
    }

    public init(pilot: Pilot) {
        self.init(
            cid: pilot.cid, callsign: pilot.callsign, lat: Float(pilot.latitude), lon: Float(pilot.longitude),
            altitude: Int32(clamping: pilot.altitude), groundspeed: Int16(clamping: pilot.groundspeed),
            heading: Int16(clamping: pilot.heading), departure: pilot.flightPlan?.departure ?? "",
            arrival: pilot.flightPlan?.arrival ?? "", aircraftType: pilot.flightPlan?.aircraftType ?? ""
        )
    }
}

public struct CompactController: Codable, Sendable, Hashable, Identifiable {
    public var cid: Int
    public var callsign: String
    public var frequency: String
    /// `Facility.rawValue`.
    public var facility: UInt8

    public var id: String { callsign }
    public var position: ATCPosition {
        ATCPosition(callsign: callsign, facility: Facility(rawValue: Int(facility)) ?? .observer)
    }

    public init(cid: Int, callsign: String, frequency: String, facility: UInt8) {
        self.cid = cid
        self.callsign = callsign
        self.frequency = frequency
        self.facility = facility
    }

    public init(controller: Controller) {
        self.init(cid: controller.cid, callsign: controller.callsign, frequency: controller.frequency,
                  facility: UInt8(clamping: controller.facility.rawValue))
    }
}
