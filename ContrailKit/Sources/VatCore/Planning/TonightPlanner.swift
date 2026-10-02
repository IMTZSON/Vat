import Foundation

/// Why an airport or route is suggested.
public enum SuggestionReason: Codable, Sendable, Hashable {
    case atcOnline([ATCPosition])
    case atcBooked([ATCPosition], from: Date)
    case event(name: String, id: Int)
    case traffic(count: Int)
    case enrouteCoverage(CoverageState)
    /// Route suggestions: both ends staffed (online or booked).
    case bothEndsCovered
    /// Route suggestions: the pair is an official event route.
    case eventRoute(name: String, id: Int)
}

public struct AirportSuggestion: Codable, Sendable, Hashable, Identifiable {
    public var icao: String
    public var score: Double
    public var reasons: [SuggestionReason]
    /// Best coverage of the airport during the window (local positions or enroute).
    public var coverageState: CoverageState
    /// An event involves this airport during the window.
    public var isFeatured: Bool

    public var id: String { icao }
}

public struct RouteSuggestion: Codable, Sendable, Hashable, Identifiable {
    public var from: String
    public var to: String
    public var distanceNM: Double
    public var estimatedDuration: TimeInterval
    public var score: Double
    public var reasons: [SuggestionReason]

    public var id: String { "\(from)-\(to)" }
}

/// "Dove volare stasera": ranks airports and routes for a time window by expected ATC, events and traffic.
///
/// Airport score = Σ online local positions (APP/DEP 3, TWR 2.5, GND 1.5, DEL 1, ATIS 0.5; counted only if
/// the window starts within 2 h of `now`) + 0.7 × the same weights for positions **booked** in the window
/// (not already online) + 6 if an event at the airport overlaps the window + log2(1 + movements) traffic
/// + 2 (online) / 1.4 (booked) for enroute (CTR) coverage over the airport.
public struct TonightPlanner: Sendable {
    public struct Weights: Codable, Sendable, Hashable {
        public var approach = 3.0
        public var tower = 2.5
        public var ground = 1.5
        public var delivery = 1.0
        public var atis = 0.5
        public var bookedFactor = 0.7
        public var event = 6.0
        public var trafficPerLog2 = 1.0
        public var enrouteOnline = 2.0
        public var enrouteBooked = 1.4
        public var bothEndsCovered = 3.0
        public var eventRoute = 8.0

        public init() {}

        public func weight(for position: ATCPosition) -> Double {
            switch position {
            case .approach, .departure: approach
            case .tower: tower
            case .ground: ground
            case .delivery: delivery
            case .atis: atis
            default: 0
            }
        }
    }

    public var airports: [String: Airport]
    public var onlinePositions: [String: Set<ATCPosition>]
    public var coverage: @Sendable (GeoPoint) -> CoverageState
    public var bookings: [ATCBooking]
    public var events: [VatsimEvent]
    /// Movements (departures + arrivals) per ICAO.
    public var traffic: [String: Int]
    public var window: DateInterval
    public var now: Date
    public var weights: Weights

    public init(
        airports: [Airport], onlinePositions: [String: Set<ATCPosition>],
        coverage: @escaping @Sendable (GeoPoint) -> CoverageState = { _ in .offline },
        bookings: [ATCBooking] = [], events: [VatsimEvent] = [], pilots: [Pilot] = [], prefiles: [Prefile] = [],
        window: DateInterval, now: Date, weights: Weights = Weights()
    ) {
        var byICAO: [String: Airport] = [:]
        for a in airports where !a.isPseudo { byICAO[a.icao.uppercased()] = a }
        self.airports = byICAO
        self.onlinePositions = onlinePositions
        self.coverage = coverage
        self.bookings = bookings
        self.events = events
        var traffic: [String: Int] = [:]
        for plan in pilots.compactMap(\.flightPlan) + prefiles.compactMap(\.flightPlan) {
            if !plan.departure.isEmpty { traffic[plan.departure, default: 0] += 1 }
            if !plan.arrival.isEmpty, plan.arrival != plan.departure { traffic[plan.arrival, default: 0] += 1 }
        }
        self.traffic = traffic
        self.window = window
        self.now = now
        self.weights = weights
    }

    var onlineCounts: Bool { window.start.timeIntervalSince(now) <= 2 * 3600 && window.end > now }

    /// Events overlapping the window.
    var activeEvents: [VatsimEvent] { events.filter { $0.interval.intersects(window) }.sorted { ($0.start, $0.id) < ($1.start, $1.id) } }

    /// Ranked airports with a positive score.
    public func suggestions(limit: Int? = nil) -> [AirportSuggestion] {
        var candidates = Set(onlinePositions.keys.map { $0.uppercased() })
        for b in bookings where b.overlaps(window) { candidates.insert(b.prefix) }
        let events = activeEvents
        for e in events {
            candidates.formUnion(e.airports)
            for r in e.routes { candidates.insert(r.departure); candidates.insert(r.arrival) }
        }
        candidates.formUnion(traffic.keys)

        var result: [AirportSuggestion] = []
        for icao in candidates {
            guard let airport = airports[icao] else { continue }
            var score = 0.0
            var reasons: [SuggestionReason] = []
            var state = CoverageState.offline

            let online = onlineCounts ? (onlinePositions[icao] ?? []).filter { weights.weight(for: $0) > 0 } : []
            if !online.isEmpty {
                score += online.reduce(0) { $0 + weights.weight(for: $1) }
                reasons.append(.atcOnline(online.sorted()))
                state = .online
            }

            let booked = bookings.filter { $0.prefix == icao && $0.overlaps(window) }
            var bookedPositions: Set<ATCPosition> = []
            for b in booked {
                let p = ATCPosition(callsign: b.callsign, facility: .observer)
                if weights.weight(for: p) > 0, !online.contains(p) { bookedPositions.insert(p) }
            }
            if !bookedPositions.isEmpty {
                score += bookedPositions.reduce(0) { $0 + weights.weight(for: $1) } * weights.bookedFactor
                let from = booked.filter { bookedPositions.contains(ATCPosition(callsign: $0.callsign, facility: .observer)) }
                    .map(\.start).min() ?? window.start
                reasons.append(.atcBooked(bookedPositions.sorted(), from: from))
                state = max(state, .booked)
            }

            var featured = false
            for e in events where e.airports.contains(icao) || e.routes.contains(where: { $0.departure == icao || $0.arrival == icao }) {
                if !featured { score += weights.event }
                featured = true
                reasons.append(.event(name: e.name, id: e.id))
            }

            if let movements = traffic[icao], movements > 0 {
                score += log2(1 + Double(movements)) * weights.trafficPerLog2
                reasons.append(.traffic(count: movements))
            }

            let enroute = onlineCounts ? coverage(airport.position) : .offline
            switch enroute {
            case .online: score += weights.enrouteOnline
            case .booked: score += weights.enrouteBooked
            case .offline: break
            }
            if enroute != .offline {
                reasons.append(.enrouteCoverage(enroute))
                state = max(state, enroute)
            }

            guard score > 0 else { continue }
            result.append(AirportSuggestion(icao: icao, score: score, reasons: reasons, coverageState: state,
                                            isFeatured: featured))
        }
        result.sort { ($0.score, $1.icao) > ($1.score, $0.icao) }
        if let limit { return Array(result.prefix(limit)) }
        return result
    }

    /// Ranked city pairs between top airports (and event routes), `distanceRange` NM apart.
    /// Score = sum of both airport scores + 3 if both ends are staffed + 8 for an event route.
    /// Each airport appears in at most `maxPerAirport` suggestions for variety.
    public func routes(
        limit: Int = 10, distanceRange: ClosedRange<Double> = 150...2_500, cruiseSpeedKt: Double = 450,
        candidatePool: Int = 30, maxPerAirport: Int = 3
    ) -> [RouteSuggestion] {
        let all = suggestions()
        let byICAO = Dictionary(uniqueKeysWithValues: all.map { ($0.icao, $0) })
        let pool = Array(all.prefix(candidatePool))

        var eventRoutes: [String: VatsimEvent] = [:]
        for e in activeEvents {
            for r in e.routes where eventRoutes["\(r.departure)-\(r.arrival)"] == nil {
                eventRoutes["\(r.departure)-\(r.arrival)"] = e
            }
        }

        var pairs: [String: RouteSuggestion] = [:]
        func consider(_ from: String, _ to: String) {
            guard from != to, let a = airports[from], let b = airports[to] else { return }
            let distance = a.position.distance(to: b.position)
            let event = eventRoutes["\(from)-\(to)"]
            guard distanceRange.contains(distance) || event != nil else { return }
            let sa = byICAO[from], sb = byICAO[to]
            var score = (sa?.score ?? 0) + (sb?.score ?? 0)
            var reasons: [SuggestionReason] = []
            if let sa, let sb, sa.coverageState != .offline, sb.coverageState != .offline {
                score += weights.bothEndsCovered
                reasons.append(.bothEndsCovered)
            }
            if let event {
                score += weights.eventRoute
                reasons.append(.eventRoute(name: event.name, id: event.id))
            }
            reasons += (sa?.reasons ?? []) + (sb?.reasons ?? []).filter { !(sa?.reasons ?? []).contains($0) }
            let profile = SpeedProfile(cruiseKt: cruiseSpeedKt)
            let duration = profile.timeFromStart(toDistance: distance, total: distance) + 20 * 60 // taxi/departure/arrival
            let key = [from, to].sorted().joined(separator: "-")
            let suggestion = RouteSuggestion(from: from, to: to, distanceNM: distance, estimatedDuration: duration,
                                             score: score, reasons: reasons)
            if let existing = pairs[key] {
                // Keep the event direction, otherwise the higher score (ties: alphabetical).
                let existingIsEvent = eventRoutes[existing.id] != nil
                let newIsEvent = event != nil
                if existingIsEvent && !newIsEvent { return }
                if existingIsEvent == newIsEvent && existing.score >= score { return }
            }
            pairs[key] = suggestion
        }

        for (i, a) in pool.enumerated() {
            for b in pool[(i + 1)...] {
                // Higher-scored airport first as the departure.
                consider(a.icao, b.icao)
            }
        }
        for key in eventRoutes.keys.sorted() {
            let parts = key.split(separator: "-").map(String.init)
            if parts.count == 2 { consider(parts[0], parts[1]) }
        }

        let sorted = pairs.values.sorted { ($0.score, $1.distanceNM, $1.id) > ($1.score, $0.distanceNM, $0.id) }
        var perAirport: [String: Int] = [:]
        var result: [RouteSuggestion] = []
        for s in sorted {
            if perAirport[s.from, default: 0] >= maxPerAirport || perAirport[s.to, default: 0] >= maxPerAirport {
                continue
            }
            perAirport[s.from, default: 0] += 1
            perAirport[s.to, default: 0] += 1
            result.append(s)
            if result.count >= limit { break }
        }
        return result
    }
}
