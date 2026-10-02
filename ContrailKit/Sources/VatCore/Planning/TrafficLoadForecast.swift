import Foundation

/// Expected traffic in a volume during one time bucket.
public struct TrafficBucket: Codable, Sendable, Hashable {
    public var start: Date
    public var end: Date
    public var arrivals: Int
    public var departures: Int
    public var overflights: Int

    public var total: Int { arrivals + departures + overflights }
    public var interval: DateInterval { DateInterval(start: start, end: max(start, end)) }

    public init(start: Date, end: Date, arrivals: Int = 0, departures: Int = 0, overflights: Int = 0) {
        self.start = start
        self.end = end
        self.arrivals = arrivals
        self.departures = departures
        self.overflights = overflights
    }
}

/// Qualitative load level of a bucket.
public enum TrafficLevel: String, Codable, Sendable, Hashable, CaseIterable, Comparable {
    case quiet, moderate, busy, veryBusy

    /// Minimum bucket totals for `.moderate`, `.busy`, `.veryBusy`.
    public struct Thresholds: Codable, Sendable, Hashable {
        public var moderate: Int
        public var busy: Int
        public var veryBusy: Int

        public init(moderate: Int, busy: Int, veryBusy: Int) {
            self.moderate = moderate
            self.busy = busy
            self.veryBusy = veryBusy
        }

        /// Per 30-minute bucket, for an area volume (FIR/UIR/TRACON).
        public static let area = Thresholds(moderate: 5, busy: 15, veryBusy: 30)
        /// Per 30-minute bucket, for a single airport.
        public static let airport = Thresholds(moderate: 3, busy: 8, veryBusy: 15)

        public static func `default`(for kind: AirspaceVolume.Kind) -> Thresholds {
            kind == .airport ? .airport : .area
        }
    }

    public init(total: Int, thresholds: Thresholds = .area) {
        if total >= thresholds.veryBusy { self = .veryBusy }
        else if total >= thresholds.busy { self = .busy }
        else if total >= thresholds.moderate { self = .moderate }
        else { self = .quiet }
    }

    var order: Int {
        switch self {
        case .quiet: 0
        case .moderate: 1
        case .busy: 2
        case .veryBusy: 3
        }
    }

    public static func < (lhs: TrafficLevel, rhs: TrafficLevel) -> Bool { lhs.order < rhs.order }

    public var title: String {
        switch self {
        case .quiet: "Quiet"
        case .moderate: "Moderate"
        case .busy: "Busy"
        case .veryBusy: "Very busy"
        }
    }
}

/// Result of a traffic forecast.
public struct TrafficForecast: Codable, Sendable, Hashable {
    public var volumeID: String
    public var buckets: [TrafficBucket]
    public var thresholds: TrafficLevel.Thresholds

    public var peak: TrafficBucket? {
        buckets.max { ($0.total, $1.start) < ($1.total, $0.start) } // earliest bucket among equal maxima
    }
    public var peakLevel: TrafficLevel { TrafficLevel(total: peak?.total ?? 0, thresholds: thresholds) }
    public func level(of bucket: TrafficBucket) -> TrafficLevel { TrafficLevel(total: bucket.total, thresholds: thresholds) }
    public var totalMovements: Int { buckets.reduce(0) { $0 + $1.total } }
}

/// Forecast of arrivals, departures and overflights for an airspace volume.
///
/// Each flight is modelled as a great circle from its current position (airborne) or departure airport
/// (on ground / prefiled, from the filed departure time) to its arrival, flown at max(GS, filed TAS, 150 kt):
/// - **arrival**: destination inside the volume, counted at the ETA (override with `etaByCallsign`);
/// - **departure**: origin inside the volume, counted at the filed departure time (never earlier than `now`);
/// - **overflight**: neither, but the path enters the volume, counted at the entry time (override with
///   `entryTimeByCallsign`). A flight that both departs and arrives inside counts in both buckets.
public enum TrafficLoadForecast {
    public static func forecast(
        volume: AirspaceVolume, pilots: [Pilot], prefiles: [Prefile] = [], airports: (String) -> Airport?,
        now: Date, horizonHours: Double = 4, bucketMinutes: Double = 30,
        etaByCallsign: [String: Date] = [:], entryTimeByCallsign: [String: Date] = [:],
        thresholds: TrafficLevel.Thresholds? = nil
    ) -> TrafficForecast {
        let bucketLength = max(60, bucketMinutes * 60)
        let count = max(1, Int((horizonHours * 3600 / bucketLength).rounded(.up)))
        var buckets = (0..<count).map {
            TrafficBucket(start: now.addingTimeInterval(Double($0) * bucketLength),
                          end: now.addingTimeInterval(Double($0 + 1) * bucketLength))
        }
        let horizonEnd = now.addingTimeInterval(Double(count) * bucketLength)
        func bucketIndex(_ date: Date) -> Int? {
            guard date >= now, date < horizonEnd else { return nil }
            return min(count - 1, Int(date.timeIntervalSince(now) / bucketLength))
        }
        let volumeBounds = volume.bounds.expanded(byDegrees: 0.5)

        enum Kind { case arrival, departure, overflight }
        func add(_ kind: Kind, at date: Date) {
            guard let i = bucketIndex(date) else { return }
            switch kind {
            case .arrival: buckets[i].arrivals += 1
            case .departure: buckets[i].departures += 1
            case .overflight: buckets[i].overflights += 1
            }
        }

        /// Time at which the great circle `from → to` (flown from `start` at `speed`) first enters the volume.
        func entryTime(from: GeoPoint, to: GeoPoint, start: Date, speed: Double) -> Date? {
            let total = from.distance(to: to)
            guard let pathBounds = GeoBounds(points: from.greatCirclePath(to: to, maxSegmentNM: 200)),
                  pathBounds.expanded(byDegrees: 0.5).intersects(volumeBounds) || volume.contains(from)
            else { return nil }
            let step = 10.0
            var d = 0.0
            while d <= total + step / 2 {
                let fraction = total > 0 ? min(1, d / total) : 0
                let p = from.intermediate(to: to, fraction: fraction)
                if volume.contains(p) { return start.addingTimeInterval(min(d, total) / speed * 3600) }
                d += step
            }
            return nil
        }

        func handle(callsign: String, plan: FlightPlan, currentPosition: GeoPoint?, groundspeed: Int, onGround: Bool) {
            let dep = plan.departure.isEmpty ? nil : airports(plan.departure)
            let arr = plan.arrival.isEmpty ? nil : airports(plan.arrival)
            let depInside = dep.map { volume.contains($0.position) } ?? false
            let arrInside = arr.map { volume.contains($0.position) } ?? false
            let tas = Double(plan.cruiseSpeedKnots ?? 0)

            if onGround {
                guard let dep else { return }
                var departureTime = plan.departureDate(relativeTo: now) ?? now
                if departureTime < now { departureTime = now }
                if depInside { add(.departure, at: departureTime) }
                guard let arr else { return }
                let speed = max(150, tas > 0 ? tas : 350)
                let flightTime = plan.enrouteDuration ?? SpeedProfile(cruiseKt: speed)
                    .timeFromStart(toDistance: dep.position.distance(to: arr.position), total: dep.position.distance(to: arr.position))
                if arrInside {
                    add(.arrival, at: etaByCallsign[callsign] ?? departureTime.addingTimeInterval(flightTime))
                } else if !depInside {
                    if let t = entryTimeByCallsign[callsign] ?? entryTime(from: dep.position, to: arr.position,
                                                                           start: departureTime, speed: speed) {
                        add(.overflight, at: t)
                    }
                }
                return
            }

            guard let position = currentPosition else { return }
            let speed = max(150, Double(groundspeed), tas)
            if let arr {
                if arrInside {
                    let eta = etaByCallsign[callsign] ?? now.addingTimeInterval(
                        SpeedProfile(cruiseKt: speed).timeToGo(remaining: position.distance(to: arr.position),
                                                                currentSpeedKt: Double(groundspeed)))
                    add(.arrival, at: eta)
                } else if let t = entryTimeByCallsign[callsign] ?? entryTime(from: position, to: arr.position,
                                                                              start: now, speed: speed) {
                    add(.overflight, at: t)
                }
            } else if let t = entryTimeByCallsign[callsign] {
                add(.overflight, at: t)
            } else if volume.contains(position) {
                add(.overflight, at: now)
            }
        }

        for pilot in pilots {
            guard let plan = pilot.flightPlan else {
                if let t = entryTimeByCallsign[pilot.callsign] { add(.overflight, at: t) }
                else if pilot.groundspeed >= 50, volume.contains(pilot.position) { add(.overflight, at: now) }
                continue
            }
            let dep = plan.departure.isEmpty ? nil : airports(plan.departure)
            let arr = plan.arrival.isEmpty ? nil : airports(plan.arrival)
            let phase = FlightPhaseDetector.phase(pilot: pilot, departure: dep, arrival: arr, verticalRateFpm: nil,
                                                  filedCruiseFt: plan.cruiseAltitudeFeet)
            if phase.isFinished { continue }
            handle(callsign: pilot.callsign, plan: plan, currentPosition: pilot.position,
                   groundspeed: pilot.groundspeed, onGround: phase.isBeforeDeparture)
        }
        for prefile in prefiles {
            guard let plan = prefile.flightPlan, plan.departureDate(relativeTo: now) != nil else { continue }
            handle(callsign: prefile.callsign, plan: plan, currentPosition: nil, groundspeed: 0, onGround: true)
        }
        return TrafficForecast(volumeID: volume.id, buckets: buckets,
                               thresholds: thresholds ?? .default(for: volume.kind))
    }
}
