import Foundation

/// A flight of the user's CID as observed by the app (DECISIONS D-016). Persisted in SwiftData/CloudKit.
public struct FlightRecord: Codable, Hashable, Sendable, Identifiable {
    /// UUID string, deterministic for (cid, callsign, firstSeen) so that two devices observing the same
    /// flight from the same first sample produce the same id.
    public var id: String
    public var cid: Int
    public var callsign: String
    public var departure: String
    public var arrival: String
    public var aircraftType: String
    public var firstSeen: Date
    public var lastSeen: Date
    public var takeoffAt: Date?
    public var landedAt: Date?
    /// ICAO where the aircraft was seen landing (may differ from `arrival` after a diversion).
    public var landedAirport: String?
    public var distanceFlownNM: Double
    public var maxAltitudeFt: Int
    /// Highest |latitude| observed (for the polar badge).
    public var maxAbsLatitude: Double?
    /// Landed after being observed airborne.
    public var completed: Bool

    public init(
        id: String? = nil, cid: Int, callsign: String, departure: String, arrival: String, aircraftType: String,
        firstSeen: Date, lastSeen: Date? = nil, takeoffAt: Date? = nil, landedAt: Date? = nil,
        landedAirport: String? = nil, distanceFlownNM: Double = 0, maxAltitudeFt: Int = 0,
        maxAbsLatitude: Double? = nil, completed: Bool = false
    ) {
        self.id = id ?? Self.makeID(cid: cid, callsign: callsign, firstSeen: firstSeen)
        self.cid = cid
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.aircraftType = aircraftType
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen ?? firstSeen
        self.takeoffAt = takeoffAt
        self.landedAt = landedAt
        self.landedAirport = landedAirport
        self.distanceFlownNM = distanceFlownNM
        self.maxAltitudeFt = maxAltitudeFt
        self.maxAbsLatitude = maxAbsLatitude
        self.completed = completed
    }

    /// Airport where the flight ended (landed airport, else filed arrival).
    public var destination: String { landedAirport ?? arrival }
    /// Reference date for statistics: landing, else last observation.
    public var referenceDate: Date { landedAt ?? lastSeen }
    public var blockDuration: TimeInterval? {
        guard let t = takeoffAt, let l = landedAt else { return nil }
        return l.timeIntervalSince(t)
    }

    /// Name-based UUID (FNV-1a 128 bit folded) formatted as a version-5-style UUID string.
    static func makeID(cid: Int, callsign: String, firstSeen: Date) -> String {
        let key = "\(cid)|\(callsign)|\(Int(firstSeen.timeIntervalSince1970))"
        func fnv(_ seed: UInt64) -> UInt64 {
            var h: UInt64 = 0xcbf2_9ce4_8422_2325 ^ seed
            for b in key.utf8 {
                h ^= UInt64(b)
                h = h &* 0x0000_0100_0000_01B3
            }
            return h
        }
        let a = fnv(0), b = fnv(0x9E37_79B9_7F4A_7C15)
        var bytes = [UInt8](repeating: 0, count: 16)
        for i in 0..<8 {
            bytes[i] = UInt8(truncatingIfNeeded: a >> (8 * UInt64(i)))
            bytes[8 + i] = UInt8(truncatingIfNeeded: b >> (8 * UInt64(i)))
        }
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        let uuid = UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                               bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
        return uuid.uuidString
    }
}

/// Something that happened while observing a CID.
public enum FlightRecordEvent: Sendable, Hashable {
    case opened(FlightRecord)
    case tookOff(FlightRecord)
    case landed(FlightRecord)
    /// The record will not be updated any more (new flight, callsign change, or 30 min gap).
    case closed(FlightRecord)
}

/// State machine turning successive observations of one CID into `FlightRecord`s.
///
/// - A record is **opened** at the first observation with a callsign.
/// - **Take-off**: on ground → airborne transition (if first seen airborne, `takeoffAt` stays nil but the
///   flight still counts as observed airborne).
/// - **Landing** (D-016): after being airborne, on ground with GS < 40 kt within 5 NM of the filed arrival
///   or of any airport returned by `nearestAirport`.
/// - A **new flight** starts when the callsign changes, after a gap of more than `gapThreshold` (30 min),
///   when the departure/arrival change after landing, or when the aircraft takes off again after landing.
///   While airborne a re-filed arrival just updates the record (diversion).
public struct FlightRecorder: Codable, Sendable, Hashable {
    public let cid: Int
    public private(set) var current: FlightRecord?
    public var gapThreshold: TimeInterval
    public var landingRadiusNM: Double
    public var landingMaxGroundspeed: Int

    private var lastPosition: GeoPoint?
    private var lastOnGround: Bool?
    private var sawAirborne = false

    public init(cid: Int, current: FlightRecord? = nil, gapThreshold: TimeInterval = 30 * 60,
                landingRadiusNM: Double = 5, landingMaxGroundspeed: Int = 40) {
        self.cid = cid
        self.current = current
        self.gapThreshold = gapThreshold
        self.landingRadiusNM = landingRadiusNM
        self.landingMaxGroundspeed = landingMaxGroundspeed
        if let current {
            sawAirborne = current.takeoffAt != nil || current.maxAltitudeFt > 0 && current.distanceFlownNM > 5
        }
    }

    /// Feeds one observation. Observations for other CIDs are ignored.
    @discardableResult
    public mutating func observe(
        _ pilot: Pilot, at now: Date, airport: (String) -> Airport?,
        nearestAirport: (GeoPoint) -> Airport? = { _ in nil }
    ) -> [FlightRecordEvent] {
        guard pilot.cid == cid, !pilot.callsign.isEmpty else { return [] }
        var events: [FlightRecordEvent] = []
        let plan = pilot.flightPlan
        let departure = plan?.departure ?? ""
        let arrival = plan?.arrival ?? ""

        let depAirport = departure.isEmpty ? nil : airport(departure)
        let arrAirport = arrival.isEmpty ? nil : airport(arrival)
        let nearest = nearestAirport(pilot.position)
        let nearby = [depAirport, arrAirport, nearest].compactMap { $0 }
        let onGround = FlightPhaseDetector.isOnGround(pilot: pilot, nearby: nearby)

        if let record = current {
            var startNew = false
            if now.timeIntervalSince(record.lastSeen) > gapThreshold { startNew = true }
            if record.callsign != pilot.callsign { startNew = true }
            if record.landedAt != nil {
                if !onGround { startNew = true } // took off again
                if !departure.isEmpty && (departure != record.departure || arrival != record.arrival) { startNew = true }
            }
            if startNew { events += close() }
        }

        if current == nil {
            let record = FlightRecord(
                cid: cid, callsign: pilot.callsign, departure: departure, arrival: arrival,
                aircraftType: plan?.aircraftType ?? "", firstSeen: now, lastSeen: now
            )
            current = record
            lastPosition = nil
            lastOnGround = nil
            sawAirborne = false
            events.append(.opened(record))
        }
        guard var record = current else { return events }

        // Plan updates: before take-off anything goes; airborne only arrival/aircraft refinements.
        if !departure.isEmpty {
            if record.takeoffAt == nil && !sawAirborne {
                record.departure = departure
            } else if record.departure.isEmpty {
                record.departure = departure
            }
            if record.landedAt == nil { record.arrival = arrival }
        }
        if let type = plan?.aircraftType, !type.isEmpty, record.landedAt == nil { record.aircraftType = type }

        // Distance and extremes.
        if let last = lastPosition {
            let leg = last.distance(to: pilot.position)
            let dt = now.timeIntervalSince(record.lastSeen)
            if leg <= max(5, 700 * 1.5 * dt / 3600) { record.distanceFlownNM += leg }
        }
        record.maxAltitudeFt = max(record.maxAltitudeFt, pilot.altitude)
        record.maxAbsLatitude = max(record.maxAbsLatitude ?? 0, abs(pilot.latitude))
        record.lastSeen = now

        // Transitions.
        if !onGround {
            if lastOnGround == true && record.takeoffAt == nil {
                record.takeoffAt = now
                current = record
                events.append(.tookOff(record))
            }
            sawAirborne = true
        } else if sawAirborne, record.landedAt == nil, pilot.groundspeed < landingMaxGroundspeed {
            let candidates = [arrAirport, nearest].compactMap { $0 }
            if let landedAt = candidates.first(where: { $0.position.distance(to: pilot.position) <= landingRadiusNM }) {
                record.landedAt = now
                record.landedAirport = landedAt.icao
                record.completed = true
                current = record
                events.append(.landed(record))
            }
        }

        lastPosition = pilot.position
        lastOnGround = onGround
        current = record
        return events
    }

    /// Call periodically when the CID is **not** in the feed: closes the record after `gapThreshold`.
    @discardableResult
    public mutating func tick(now: Date) -> [FlightRecordEvent] {
        guard let record = current, now.timeIntervalSince(record.lastSeen) > gapThreshold else { return [] }
        return close()
    }

    /// Closes the current record immediately (e.g. app termination while a flight is open is *not* a reason;
    /// use for explicit user actions or data migrations).
    @discardableResult
    public mutating func close() -> [FlightRecordEvent] {
        guard var record = current else { return [] }
        record.completed = record.landedAt != nil
        current = nil
        lastPosition = nil
        lastOnGround = nil
        sawAirborne = false
        return [.closed(record)]
    }
}
