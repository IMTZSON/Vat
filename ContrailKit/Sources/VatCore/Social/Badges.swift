import Foundation

public enum BadgeTier: String, Codable, Sendable, Hashable, CaseIterable, Comparable {
    case bronze, silver, gold, platinum

    var order: Int {
        switch self {
        case .bronze: 0
        case .silver: 1
        case .gold: 2
        case .platinum: 3
        }
    }

    public static func < (lhs: BadgeTier, rhs: BadgeTier) -> Bool { lhs.order < rhs.order }
}

public enum BadgeCategory: String, Codable, Sendable, Hashable, CaseIterable {
    case milestones, distance, exploration, timing, aircraft, challenge
}

/// Static description of a badge. IDs are stable (persisted and synced).
public struct BadgeDefinition: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// SF Symbol name.
    public var symbolName: String
    public var title: String
    public var description: String
    public var tier: BadgeTier
    public var category: BadgeCategory
    public var target: Int

    public init(id: String, symbolName: String, title: String, description: String, tier: BadgeTier,
                category: BadgeCategory, target: Int) {
        self.id = id
        self.symbolName = symbolName
        self.title = title
        self.description = description
        self.tier = tier
        self.category = category
        self.target = target
    }
}

/// Progress towards a badge.
public struct BadgeProgress: Codable, Sendable, Hashable, Identifiable {
    public var badge: BadgeDefinition
    /// Capped at `target`.
    public var current: Int
    public var target: Int
    /// When the badge was earned (the reference date of the record that completed it).
    public var earnedAt: Date?

    public var id: String { badge.id }
    public var isEarned: Bool { earnedAt != nil }
    public var fraction: Double { target > 0 ? min(1, Double(current) / Double(target)) : 0 }
}

public enum BadgeCatalog {
    public enum ID {
        public static let firstFlight = "flights.first"
        public static let flights10 = "flights.10"
        public static let flights50 = "flights.50"
        public static let flights100 = "flights.100"
        public static let flights500 = "flights.500"
        public static let longHaul = "distance.longhaul"
        public static let ultraLongHaul = "distance.ultralonghaul"
        public static let totalDistance10k = "distance.total10k"
        public static let airports10 = "explore.airports10"
        public static let airports25 = "explore.airports25"
        public static let countries5 = "explore.countries5"
        public static let countries15 = "explore.countries15"
        public static let europeanCapitals = "challenge.eucapitals"
        public static let nightOwl = "timing.nightowl"
        public static let atlanticCrosser = "explore.atlantic"
        public static let polar = "explore.polar"
        public static let weekendWarrior = "timing.weekend"
        public static let streak7 = "timing.streak7"
        public static let heavyMetal = "aircraft.heavy"
        public static let turboprop = "aircraft.turboprop"
        public static let regionalHopper = "aircraft.regional"
    }

    public static let all: [BadgeDefinition] = [
        BadgeDefinition(id: ID.firstFlight, symbolName: "airplane.departure", title: "First Flight",
                        description: "Complete your first observed flight.", tier: .bronze, category: .milestones, target: 1),
        BadgeDefinition(id: ID.flights10, symbolName: "10.circle", title: "Frequent Flyer",
                        description: "Complete 10 flights.", tier: .bronze, category: .milestones, target: 10),
        BadgeDefinition(id: ID.flights50, symbolName: "50.circle", title: "Seasoned Aviator",
                        description: "Complete 50 flights.", tier: .silver, category: .milestones, target: 50),
        BadgeDefinition(id: ID.flights100, symbolName: "100.circle", title: "Centurion",
                        description: "Complete 100 flights.", tier: .gold, category: .milestones, target: 100),
        BadgeDefinition(id: ID.flights500, symbolName: "star.circle", title: "Network Legend",
                        description: "Complete 500 flights.", tier: .platinum, category: .milestones, target: 500),
        BadgeDefinition(id: ID.longHaul, symbolName: "globe.europe.africa", title: "Long Haul",
                        description: "Complete a flight longer than 3,000 NM.", tier: .silver, category: .distance, target: 1),
        BadgeDefinition(id: ID.ultraLongHaul, symbolName: "globe", title: "Ultra Long Haul",
                        description: "Complete a flight longer than 5,500 NM.", tier: .gold, category: .distance, target: 1),
        BadgeDefinition(id: ID.totalDistance10k, symbolName: "point.topleft.down.to.point.bottomright.curvepath",
                        title: "Ten Thousand Miles", description: "Fly 10,000 NM in total.", tier: .silver,
                        category: .distance, target: 10_000),
        BadgeDefinition(id: ID.airports10, symbolName: "mappin.and.ellipse", title: "Explorer",
                        description: "Visit 10 different airports.", tier: .bronze, category: .exploration, target: 10),
        BadgeDefinition(id: ID.airports25, symbolName: "map", title: "Pathfinder",
                        description: "Visit 25 different airports.", tier: .silver, category: .exploration, target: 25),
        BadgeDefinition(id: ID.countries5, symbolName: "flag", title: "Border Hopper",
                        description: "Visit airports in 5 countries.", tier: .bronze, category: .exploration, target: 5),
        BadgeDefinition(id: ID.countries15, symbolName: "flag.2.crossed", title: "Globetrotter",
                        description: "Visit airports in 15 countries.", tier: .gold, category: .exploration, target: 15),
        BadgeDefinition(id: ID.europeanCapitals, symbolName: "building.columns", title: "European Capitals",
                        description: "Land in every European capital.", tier: .platinum, category: .challenge,
                        target: EuropeanCapitals.all.count),
        BadgeDefinition(id: ID.nightOwl, symbolName: "moon.stars", title: "Night Owl",
                        description: "Land between 00:00 and 05:00 UTC.", tier: .bronze, category: .timing, target: 1),
        BadgeDefinition(id: ID.atlanticCrosser, symbolName: "water.waves", title: "Atlantic Crosser",
                        description: "Fly between Europe/Africa and the Americas.", tier: .silver,
                        category: .exploration, target: 1),
        BadgeDefinition(id: ID.polar, symbolName: "snowflake", title: "Polar Explorer",
                        description: "Fly beyond the Arctic or Antarctic circle (66.5°).", tier: .gold,
                        category: .exploration, target: 1),
        BadgeDefinition(id: ID.weekendWarrior, symbolName: "calendar.badge.clock", title: "Weekend Warrior",
                        description: "Complete 3 flights in a single weekend (UTC).", tier: .silver,
                        category: .timing, target: 3),
        BadgeDefinition(id: ID.streak7, symbolName: "flame", title: "On a Streak",
                        description: "Fly on 7 consecutive UTC days.", tier: .gold, category: .timing, target: 7),
        BadgeDefinition(id: ID.heavyMetal, symbolName: "airplane.circle", title: "Heavy Metal",
                        description: "Complete 5 flights in widebody aircraft.", tier: .silver, category: .aircraft, target: 5),
        BadgeDefinition(id: ID.turboprop, symbolName: "fanblades", title: "Prop Lover",
                        description: "Complete 5 flights in turboprop aircraft.", tier: .bronze, category: .aircraft, target: 5),
        BadgeDefinition(id: ID.regionalHopper, symbolName: "arrow.triangle.swap", title: "Regional Hopper",
                        description: "Complete 10 flights shorter than 300 NM.", tier: .silver, category: .aircraft, target: 10),
    ]

    static let byID: [String: BadgeDefinition] = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    public static func definition(id: String) -> BadgeDefinition? { byID[id] }
}

/// Evaluates badges from observed flight records. Only completed records whose reference date
/// (landing, else last seen) is not after `now` count.
public enum BadgeEngine {
    public static func evaluate(records: [FlightRecord], airports: (String) -> Airport?, now: Date) -> [BadgeProgress] {
        let flights = records
            .filter { $0.completed && $0.referenceDate <= now }
            .sorted { ($0.referenceDate, $0.id) < ($1.referenceDate, $1.id) }
        var known: [String: Airport] = [:]
        for icao in Set(flights.flatMap { [$0.departure, $0.destination] }) where !icao.isEmpty {
            if let a = airports(icao) { known[icao] = a }
        }
        let context = Context(flights: flights, airports: known)
        return BadgeCatalog.all.map { evaluate($0, context) }
    }

    /// Badges earned within `interval`.
    public static func earned(records: [FlightRecord], airports: (String) -> Airport?, in interval: DateInterval) -> [BadgeProgress] {
        evaluate(records: records, airports: airports, now: interval.end)
            .filter { $0.earnedAt.map { interval.contains($0) && $0 < interval.end } ?? false }
    }

    struct Context {
        var flights: [FlightRecord]
        var airports: [String: Airport]

        func airport(_ icao: String) -> Airport? { airports[icao] }

        /// Great-circle distance departure → destination when both are known, else the flown distance.
        func distance(_ r: FlightRecord) -> Double {
            if let a = airport(r.departure), let b = airport(r.destination), r.departure != r.destination {
                return max(a.position.distance(to: b.position), 0)
            }
            return r.distanceFlownNM
        }
    }

    static func evaluate(_ badge: BadgeDefinition, _ ctx: Context) -> BadgeProgress {
        let target = badge.target
        let (current, earned): (Int, Date?)
        typealias ID = BadgeCatalog.ID
        switch badge.id {
        case ID.firstFlight, ID.flights10, ID.flights50, ID.flights100, ID.flights500:
            (current, earned) = count(ctx.flights, target: target) { _ in true }
        case ID.longHaul:
            (current, earned) = count(ctx.flights, target: target) { ctx.distance($0) > 3_000 }
        case ID.ultraLongHaul:
            (current, earned) = count(ctx.flights, target: target) { ctx.distance($0) > 5_500 }
        case ID.totalDistance10k:
            var total = 0.0
            var date: Date?
            for f in ctx.flights {
                total += max(f.distanceFlownNM, 0)
                if date == nil, total >= Double(target) { date = f.referenceDate }
            }
            (current, earned) = (Int(total), date)
        case ID.airports10, ID.airports25:
            (current, earned) = distinct(ctx.flights, target: target) { [$0.departure, $0.destination].filter { !$0.isEmpty } }
        case ID.countries5, ID.countries15:
            (current, earned) = distinct(ctx.flights, target: target) { f in
                [f.departure, f.destination].compactMap { ctx.airport($0)?.country }.filter { !$0.isEmpty }
            }
        case ID.europeanCapitals:
            (current, earned) = distinct(ctx.flights, target: target) { f in
                f.landedAirport.flatMap { EuropeanCapitals.capital(forICAO: $0)?.country }.map { [$0] } ?? []
            }
        case ID.nightOwl:
            (current, earned) = count(ctx.flights, target: target) { f in
                f.landedAt.map { UTCCalendarDay.hour($0) < 5 } ?? false
            }
        case ID.atlanticCrosser:
            (current, earned) = count(ctx.flights, target: target) { f in
                guard let a = ctx.airport(f.departure), let b = ctx.airport(f.destination) else { return false }
                let ra = WorldRegion.of(a.position), rb = WorldRegion.of(b.position)
                return (ra == .americas && rb == .europeAfrica) || (ra == .europeAfrica && rb == .americas)
            }
        case ID.polar:
            (current, earned) = count(ctx.flights, target: target) { f in
                let ends = [f.departure, f.destination].compactMap { ctx.airport($0).map { abs($0.latitude) } }
                return max(f.maxAbsLatitude ?? 0, ends.max() ?? 0) > 66.5
            }
        case ID.weekendWarrior:
            (current, earned) = weekend(ctx.flights, target: target)
        case ID.streak7:
            (current, earned) = streak(ctx.flights, target: target)
        case ID.heavyMetal:
            (current, earned) = count(ctx.flights, target: target) { AircraftCategories.isWidebody($0.aircraftType) }
        case ID.turboprop:
            (current, earned) = count(ctx.flights, target: target) { AircraftCategories.isTurboprop($0.aircraftType) }
        case ID.regionalHopper:
            (current, earned) = count(ctx.flights, target: target) { f in
                guard f.departure != f.destination else { return false }
                let d = ctx.distance(f)
                return d > 0 && d < 300
            }
        default:
            (current, earned) = (0, nil)
        }
        return BadgeProgress(badge: badge, current: min(current, target), target: target, earnedAt: earned)
    }

    static func count(_ flights: [FlightRecord], target: Int, where predicate: (FlightRecord) -> Bool) -> (Int, Date?) {
        var n = 0
        var date: Date?
        for f in flights where predicate(f) {
            n += 1
            if n == target { date = f.referenceDate }
        }
        return (n, date)
    }

    static func distinct(_ flights: [FlightRecord], target: Int, keys: (FlightRecord) -> [String]) -> (Int, Date?) {
        var seen: Set<String> = []
        var date: Date?
        for f in flights {
            for k in keys(f) { seen.insert(k) }
            if date == nil, seen.count >= target { date = f.referenceDate }
        }
        return (seen.count, date)
    }

    /// Max flights in a single weekend (Saturday + Sunday UTC).
    static func weekend(_ flights: [FlightRecord], target: Int) -> (Int, Date?) {
        var perWeekend: [ISOWeek: Int] = [:]
        var best = 0
        var date: Date?
        for f in flights {
            let day = UTCCalendarDay.weekday(f.referenceDate)
            guard day >= 6 else { continue }
            let week = ISOWeek(containing: f.referenceDate)
            perWeekend[week, default: 0] += 1
            best = max(best, perWeekend[week] ?? 0)
            if date == nil, best >= target { date = f.referenceDate }
        }
        return (best, date)
    }

    /// Longest run of consecutive UTC days with at least one flight.
    static func streak(_ flights: [FlightRecord], target: Int) -> (Int, Date?) {
        var best = 0, run = 0
        var lastDay: Int?
        var date: Date?
        for f in flights {
            let day = UTCCalendarDay.number(f.referenceDate)
            if day == lastDay { continue }
            run = (lastDay.map { day == $0 + 1 } ?? false) ? run + 1 : 1
            lastDay = day
            best = max(best, run)
            if date == nil, best >= target { date = f.referenceDate }
        }
        return (best, date)
    }
}
