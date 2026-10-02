import Foundation

/// A time-boxed goal ("Fly 5 flights this week").
public struct ChallengeDefinition: Codable, Sendable, Hashable, Identifiable {
    public enum Period: String, Codable, Sendable, Hashable {
        /// ISO week (Monday–Sunday, UTC).
        case weekly
        /// Calendar month (UTC).
        case monthly
    }

    public enum Metric: String, Codable, Sendable, Hashable {
        case flights
        case distanceNM
        case distinctAirports
        case distinctCountries
        case nightLandings
        case widebodyFlights
        /// Longest single flight (great circle when airports are known), NM.
        case longestFlightNM
    }

    public var id: String
    public var title: String
    public var description: String
    public var symbolName: String
    public var period: Period
    public var metric: Metric
    public var target: Int

    public init(id: String, title: String, description: String, symbolName: String, period: Period,
                metric: Metric, target: Int) {
        self.id = id
        self.title = title
        self.description = description
        self.symbolName = symbolName
        self.period = period
        self.metric = metric
        self.target = target
    }

    /// The period instance containing `date`.
    public func interval(containing date: Date) -> DateInterval {
        switch period {
        case .weekly: ISOWeek(containing: date).interval
        case .monthly: UTCCalendarDay.monthInterval(containing: date)
        }
    }

    /// Stable id of the instance, e.g. "weekly.flights5@2026-W40".
    public func instanceID(containing date: Date) -> String {
        switch period {
        case .weekly:
            return "\(id)@\(ISOWeek(containing: date).id)"
        case .monthly:
            let (y, m, _) = FastISO8601.civilFromDays(UTCCalendarDay.number(date))
            return "\(id)@\(y)-\(m < 10 ? "0" : "")\(m)"
        }
    }
}

public struct ChallengeProgress: Codable, Sendable, Hashable, Identifiable {
    public var challenge: ChallengeDefinition
    public var interval: DateInterval
    /// Capped at `target`.
    public var current: Int
    public var target: Int
    public var completedAt: Date?

    public var id: String { challenge.instanceID(containing: interval.start) }
    public var isCompleted: Bool { completedAt != nil }
    public var fraction: Double { target > 0 ? min(1, Double(current) / Double(target)) : 0 }
    public func timeRemaining(now: Date) -> TimeInterval { max(0, interval.end.timeIntervalSince(now)) }
}

public enum ChallengeCatalog {
    public static let all: [ChallengeDefinition] = [
        ChallengeDefinition(id: "weekly.flights5", title: "Five a Week", description: "Fly 5 flights this week.",
                            symbolName: "5.circle", period: .weekly, metric: .flights, target: 5),
        ChallengeDefinition(id: "weekly.countries3", title: "Border Run",
                            description: "Land in 3 different countries this week.", symbolName: "flag.2.crossed",
                            period: .weekly, metric: .distinctCountries, target: 3),
        ChallengeDefinition(id: "weekly.distance2000", title: "Two Thousand",
                            description: "Fly 2,000 NM this week.", symbolName: "ruler", period: .weekly,
                            metric: .distanceNM, target: 2_000),
        ChallengeDefinition(id: "weekly.airports5", title: "Airport Collector",
                            description: "Visit 5 different airports this week.", symbolName: "mappin.and.ellipse",
                            period: .weekly, metric: .distinctAirports, target: 5),
        ChallengeDefinition(id: "weekly.night2", title: "Red-eye", description: "Land twice between 00 and 05 UTC this week.",
                            symbolName: "moon.zzz", period: .weekly, metric: .nightLandings, target: 2),
        ChallengeDefinition(id: "monthly.flights20", title: "Busy Month", description: "Fly 20 flights this month.",
                            symbolName: "calendar", period: .monthly, metric: .flights, target: 20),
        ChallengeDefinition(id: "monthly.longhaul", title: "Go Long",
                            description: "Fly a flight longer than 2,500 NM this month.", symbolName: "globe",
                            period: .monthly, metric: .longestFlightNM, target: 2_500),
        ChallengeDefinition(id: "monthly.heavy3", title: "Heavy Month",
                            description: "Fly 3 widebody flights this month.", symbolName: "airplane.circle",
                            period: .monthly, metric: .widebodyFlights, target: 3),
    ]

    public static var weekly: [ChallengeDefinition] { all.filter { $0.period == .weekly } }
    public static var monthly: [ChallengeDefinition] { all.filter { $0.period == .monthly } }
}

public enum ChallengeEngine {
    /// Progress of `challenge` for the period containing `now` (records after `now` are ignored).
    public static func progress(
        for challenge: ChallengeDefinition, records: [FlightRecord], airports: (String) -> Airport?, now: Date
    ) -> ChallengeProgress {
        let interval = challenge.interval(containing: now)
        let flights = records
            .filter { $0.completed && $0.referenceDate >= interval.start && $0.referenceDate < interval.end && $0.referenceDate <= now }
            .sorted { ($0.referenceDate, $0.id) < ($1.referenceDate, $1.id) }
        var value = 0.0
        var completedAt: Date?
        var set: Set<String> = []
        for f in flights {
            switch challenge.metric {
            case .flights: value += 1
            case .distanceNM: value += max(0, f.distanceFlownNM)
            case .distinctAirports:
                for icao in [f.departure, f.destination] where !icao.isEmpty { set.insert(icao) }
                value = Double(set.count)
            case .distinctCountries:
                if let c = airports(f.destination)?.country, !c.isEmpty { set.insert(c) }
                value = Double(set.count)
            case .nightLandings:
                if let l = f.landedAt, UTCCalendarDay.hour(l) < 5 { value += 1 }
            case .widebodyFlights:
                if AircraftCategories.isWidebody(f.aircraftType) { value += 1 }
            case .longestFlightNM:
                var d = f.distanceFlownNM
                if let a = airports(f.departure), let b = airports(f.destination) {
                    d = max(d, a.position.distance(to: b.position))
                }
                value = max(value, d)
            }
            if completedAt == nil, value >= Double(challenge.target) { completedAt = f.referenceDate }
        }
        return ChallengeProgress(challenge: challenge, interval: interval, current: min(Int(value), challenge.target),
                                 target: challenge.target, completedAt: completedAt)
    }

    public static func progress(
        for challenges: [ChallengeDefinition] = ChallengeCatalog.all, records: [FlightRecord],
        airports: (String) -> Airport?, now: Date
    ) -> [ChallengeProgress] {
        challenges.map { progress(for: $0, records: records, airports: airports, now: now) }
    }
}

/// Weekly leaderboard score (CloudKit public database, DECISIONS D-021).
///
/// Formula, for completed flights whose landing (reference date) falls in the ISO week:
/// `score = 10 × flights + ⌊Σ distanceFlownNM / 50⌋ + 25 × badges earned during the week`.
public enum LeaderboardScoring {
    public struct Breakdown: Codable, Sendable, Hashable {
        public var week: ISOWeek
        public var flights: Int
        public var distanceNM: Double
        public var badgesEarned: [String]

        public var flightPoints: Int { flights * 10 }
        public var distancePoints: Int { Int((distanceNM / 50).rounded(.down)) }
        public var badgePoints: Int { badgesEarned.count * 25 }
        public var total: Int { flightPoints + distancePoints + badgePoints }
    }

    public static func breakdown(
        records: [FlightRecord], weekContaining date: Date, airports: (String) -> Airport? = { _ in nil }
    ) -> Breakdown {
        let week = ISOWeek(containing: date)
        let interval = week.interval
        let flights = records.filter { $0.completed && interval.contains($0.referenceDate) && $0.referenceDate < interval.end }
        let distance = flights.reduce(0) { $0 + max(0, $1.distanceFlownNM) }
        let badges = BadgeEngine.earned(records: records, airports: airports, in: interval).map(\.badge.id)
        return Breakdown(week: week, flights: flights.count, distanceNM: distance, badgesEarned: badges)
    }

    public static func weeklyScore(
        records: [FlightRecord], weekContaining date: Date, airports: (String) -> Airport? = { _ in nil }
    ) -> Int {
        breakdown(records: records, weekContaining: date, airports: airports).total
    }
}
