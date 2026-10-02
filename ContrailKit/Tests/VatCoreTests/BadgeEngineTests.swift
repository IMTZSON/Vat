import XCTest
@testable import VatCore

final class BadgeEngineTests: XCTestCase {
    let base = LogicFixtures.date("2026-09-01T12:00:00Z") // a Tuesday
    let farFuture = LogicFixtures.date("2027-01-01T00:00:00Z")

    func record(_ dep: String, _ arr: String, landed: Date, type: String = "A320", distance: Double? = nil,
                maxLat: Double? = nil, completed: Bool = true, landedAirport: String? = nil) -> FlightRecord {
        let d = distance ?? {
            guard let a = LogicFixtures.airport(dep), let b = LogicFixtures.airport(arr) else { return 0 }
            return a.position.distance(to: b.position)
        }()
        return FlightRecord(
            cid: 1, callsign: "TST\(Int(landed.timeIntervalSince1970) % 100_000)", departure: dep, arrival: arr,
            aircraftType: type, firstSeen: landed.addingTimeInterval(-3_600), lastSeen: landed.addingTimeInterval(300),
            takeoffAt: landed.addingTimeInterval(-3_000), landedAt: completed ? landed : nil,
            landedAirport: completed ? (landedAirport ?? arr) : nil, distanceFlownNM: d, maxAltitudeFt: 36_000,
            maxAbsLatitude: maxLat, completed: completed
        )
    }

    func day(_ n: Int, hour: Int = 12) -> Date { base.addingTimeInterval(Double(n) * 86_400 + Double(hour - 12) * 3_600) }

    func evaluate(_ records: [FlightRecord], now: Date? = nil) -> [String: BadgeProgress] {
        let list = BadgeEngine.evaluate(records: records, airports: LogicFixtures.airport(_:), now: now ?? farFuture)
        return Dictionary(uniqueKeysWithValues: list.map { ($0.badge.id, $0) })
    }

    typealias ID = BadgeCatalog.ID

    // MARK: Catalog

    func testCatalog() {
        XCTAssertGreaterThanOrEqual(BadgeCatalog.all.count, 18)
        XCTAssertEqual(Set(BadgeCatalog.all.map(\.id)).count, BadgeCatalog.all.count, "unique ids")
        for b in BadgeCatalog.all {
            XCTAssertFalse(b.title.isEmpty)
            XCTAssertFalse(b.description.isEmpty)
            XCTAssertFalse(b.symbolName.isEmpty)
            XCTAssertGreaterThan(b.target, 0)
        }
        XCTAssertEqual(BadgeCatalog.definition(id: ID.europeanCapitals)?.target, EuropeanCapitals.all.count)
        XCTAssertEqual(EuropeanCapitals.all.count, 42)
        XCTAssertEqual(EuropeanCapitals.capital(forICAO: "egkk")?.city, "London")
        XCTAssertEqual(EuropeanCapitals.capital(forICAO: "LCLK")?.city, "Nicosia")
        XCTAssertNil(EuropeanCapitals.capital(forICAO: "LIML"))
        let empty = evaluate([])
        XCTAssertEqual(empty.count, BadgeCatalog.all.count)
        XCTAssertTrue(empty.values.allSatisfy { $0.current == 0 && !$0.isEarned })
    }

    // MARK: Milestones

    func testFlightCountMilestones() throws {
        let records = (0..<12).map { record("LIRF", "LIML", landed: day($0)) }
        let p = evaluate(records)
        XCTAssertEqual(p[ID.firstFlight]?.earnedAt, day(0))
        XCTAssertEqual(p[ID.flights10]?.earnedAt, day(9))
        XCTAssertEqual(p[ID.flights10]?.current, 10, "capped at target")
        XCTAssertEqual(p[ID.flights50]?.current, 12)
        XCTAssertNil(p[ID.flights50]?.earnedAt)
        XCTAssertEqual(p[ID.flights50]?.fraction ?? 0, 12.0 / 50, accuracy: 1e-9)
        // Incomplete flights and flights after `now` do not count.
        let partial = evaluate([record("LIRF", "LIML", landed: day(0), completed: false), record("LIRF", "LIML", landed: day(5))], now: day(3))
        XCTAssertNil(partial[ID.firstFlight]?.earnedAt)
        XCTAssertEqual(partial[ID.firstFlight]?.current, 0)
    }

    func testFlights100And500() {
        let records = (0..<500).map { record("LIRF", "LIML", landed: base.addingTimeInterval(Double($0) * 3_600)) }
        let p = evaluate(records)
        XCTAssertEqual(p[ID.flights100]?.earnedAt, base.addingTimeInterval(99 * 3_600))
        XCTAssertEqual(p[ID.flights500]?.earnedAt, base.addingTimeInterval(499 * 3_600))
        XCTAssertEqual(p[ID.totalDistance10k]?.isEarned, true)
    }

    // MARK: Distance

    func testLongHaulBadges() {
        let p = evaluate([record("LIRF", "KJFK", landed: day(0)), record("LIRF", "EGLL", landed: day(1))])
        XCTAssertTrue(p[ID.longHaul]?.isEarned ?? false, "LIRF–KJFK ≈ 3707 NM")
        XCTAssertFalse(p[ID.ultraLongHaul]?.isEarned ?? true)
        let ultra = evaluate([record("WSSS", "KJFK", landed: day(2))])
        XCTAssertEqual(ultra[ID.ultraLongHaul]?.earnedAt, day(2))
        // Great circle wins over a partial observed distance; unknown airports fall back to observed distance.
        XCTAssertTrue(evaluate([record("OMDB", "KLAX", landed: day(3), distance: 100)])[ID.ultraLongHaul]?.isEarned ?? false)
        XCTAssertTrue(evaluate([record("XXXX", "YYYY", landed: day(3), distance: 3_200)])[ID.longHaul]?.isEarned ?? false)
        XCTAssertFalse(evaluate([record("EGLL", "KJFK", landed: day(3))])[ID.longHaul]?.isEarned ?? true, "2991 NM")
    }

    func testTotalDistance() {
        let p = evaluate([record("A", "B", landed: day(0), distance: 6_000), record("A", "B", landed: day(1), distance: 4_500)])
        XCTAssertEqual(p[ID.totalDistance10k]?.earnedAt, day(1))
        XCTAssertFalse(evaluate([record("A", "B", landed: day(0), distance: 9_999)])[ID.totalDistance10k]?.isEarned ?? true)
    }

    // MARK: Exploration

    func testDistinctAirportsAndCountries() {
        let legs = [("LIRF", "LIML"), ("LIML", "EGLL"), ("EGLL", "EDDF"), ("EDDF", "LFPG"), ("LFPG", "EHAM"),
                    ("EHAM", "LEMD"), ("LEMD", "LOWW"), ("LOWW", "LGAV"), ("LGAV", "ENGM")]
        let records = legs.enumerated().map { record($1.0, $1.1, landed: day($0)) }
        let p = evaluate(records)
        XCTAssertEqual(p[ID.airports10]?.current, 10)
        XCTAssertEqual(p[ID.airports10]?.earnedAt, day(8))
        XCTAssertEqual(p[ID.airports25]?.current, 10)
        // IT, GB, DE, FR, NL → 5 countries after the 4th leg (EDDF→LFPG lands in FR, LFPG→EHAM adds NL).
        XCTAssertEqual(p[ID.countries5]?.earnedAt, day(4))
        XCTAssertEqual(p[ID.countries15]?.current, 9)
        XCTAssertFalse(evaluate(Array(records.prefix(3)))[ID.countries5]?.isEarned ?? true)
    }

    func testEuropeanCapitalsChallenge() {
        let records = [
            record("LIML", "LIRF", landed: day(0)),
            record("LIRF", "LIRA", landed: day(1), distance: 15), // Rome again (Ciampino) → still 1
            record("LIRA", "EGKK", landed: day(2)),
            record("EGKK", "LFPG", landed: day(3)),
            record("LFPG", "LIML", landed: day(4)), // Milan is not a capital
            record("LIML", "LOWW", landed: day(5), completed: false),
        ]
        let p = evaluate(records)
        XCTAssertEqual(p[ID.europeanCapitals]?.current, 3)
        XCTAssertEqual(p[ID.europeanCapitals]?.target, 42)
        XCTAssertNil(p[ID.europeanCapitals]?.earnedAt)
        // All capitals (first airport of each) → earned at the last landing.
        let all = EuropeanCapitals.all.enumerated().map { record("LIML", $1.icaos[0], landed: day($0), distance: 500) }
        let done = evaluate(all)[ID.europeanCapitals]
        XCTAssertEqual(done?.current, 42)
        XCTAssertEqual(done?.earnedAt, day(41))
    }

    func testAtlanticCrosser() {
        XCTAssertTrue(evaluate([record("EGLL", "KJFK", landed: day(0))])[ID.atlanticCrosser]?.isEarned ?? false)
        XCTAssertTrue(evaluate([record("KJFK", "BIKF", landed: day(0))])[ID.atlanticCrosser]?.isEarned ?? false, "Iceland is on the European side")
        XCTAssertFalse(evaluate([record("KJFK", "KLAX", landed: day(0))])[ID.atlanticCrosser]?.isEarned ?? true)
        XCTAssertFalse(evaluate([record("RJTT", "KLAX", landed: day(0))])[ID.atlanticCrosser]?.isEarned ?? true, "Pacific")
        XCTAssertFalse(evaluate([record("OMDB", "EGLL", landed: day(0))])[ID.atlanticCrosser]?.isEarned ?? true)
    }

    func testPolar() {
        XCTAssertTrue(evaluate([record("ENGM", "ENSB", landed: day(0))])[ID.polar]?.isEarned ?? false, "Svalbard 78°N")
        XCTAssertTrue(evaluate([record("LIRF", "KJFK", landed: day(0), maxLat: 67.2)])[ID.polar]?.isEarned ?? false, "track latitude")
        XCTAssertFalse(evaluate([record("LIRF", "KJFK", landed: day(0), maxLat: 55)])[ID.polar]?.isEarned ?? true)
        XCTAssertFalse(evaluate([record("ENGM", "BIKF", landed: day(0))])[ID.polar]?.isEarned ?? true, "64°N")
    }

    // MARK: Timing

    func testNightOwl() {
        XCTAssertEqual(evaluate([record("LIRF", "LIML", landed: day(0, hour: 3))])[ID.nightOwl]?.earnedAt, day(0, hour: 3))
        XCTAssertTrue(evaluate([record("LIRF", "LIML", landed: day(0, hour: 0))])[ID.nightOwl]?.isEarned ?? false)
        XCTAssertFalse(evaluate([record("LIRF", "LIML", landed: day(0, hour: 5))])[ID.nightOwl]?.isEarned ?? true)
        XCTAssertFalse(evaluate([record("LIRF", "LIML", landed: day(0, hour: 23))])[ID.nightOwl]?.isEarned ?? true)
    }

    func testWeekendWarrior() {
        // base = Tue 1 Sep 2026 → Sat 5, Sun 6, Mon 7.
        let ok = [record("LIRF", "LIML", landed: day(4, hour: 9)), record("LIML", "LIRF", landed: day(4, hour: 18)),
                  record("LIRF", "LIML", landed: day(5, hour: 10))]
        XCTAssertEqual(evaluate(ok)[ID.weekendWarrior]?.earnedAt, day(5, hour: 10))
        let split = [record("LIRF", "LIML", landed: day(4)), record("LIML", "LIRF", landed: day(5)),
                     record("LIRF", "LIML", landed: day(6)), record("LIRF", "LIML", landed: day(11))]
        let p = evaluate(split)[ID.weekendWarrior]
        XCTAssertFalse(p?.isEarned ?? true, "Monday and the next weekend do not combine")
        XCTAssertEqual(p?.current, 2)
    }

    func testStreak() {
        let seven = (0..<7).map { record("LIRF", "LIML", landed: day($0, hour: $0 % 2 == 0 ? 1 : 22)) }
        XCTAssertEqual(evaluate(seven)[ID.streak7]?.earnedAt, day(6, hour: 1))
        let gap = (0..<8).filter { $0 != 3 }.map { record("LIRF", "LIML", landed: day($0)) }
        let p = evaluate(gap)[ID.streak7]
        XCTAssertFalse(p?.isEarned ?? true)
        XCTAssertEqual(p?.current, 4)
        // Several flights on one day count once.
        let sameDay = (0..<7).map { record("LIRF", "LIML", landed: day(0, hour: 6 + $0)) }
        XCTAssertEqual(evaluate(sameDay)[ID.streak7]?.current, 1)
    }

    // MARK: Aircraft

    func testHeavyMetalTurbopropRegional() {
        let heavy = ["B77W", "A359", "H/B744/L", "a388", "B789"].enumerated().map { record("LIRF", "KJFK", landed: day($0), type: $1) }
        XCTAssertEqual(evaluate(heavy)[ID.heavyMetal]?.earnedAt, day(4))
        XCTAssertFalse(evaluate(Array(heavy.prefix(4)) + [record("LIRF", "LIML", landed: day(9), type: "A320")])[ID.heavyMetal]?.isEarned ?? true)
        XCTAssertTrue(AircraftCategories.isWidebody("B77W/H-SDE3FGHIJ2J3J4J5M1RWXYZ/LB1D1"))
        XCTAssertFalse(AircraftCategories.isWidebody("B738"))

        let props = (0..<5).map { record("LIRF", "LIRN", landed: day($0), type: $0 % 2 == 0 ? "AT76" : "DH8D") }
        XCTAssertTrue(evaluate(props)[ID.turboprop]?.isEarned ?? false)
        XCTAssertFalse(evaluate(Array(props.prefix(4)))[ID.turboprop]?.isEarned ?? true)

        let hops = (0..<10).map { record("LIRF", "LIRN", landed: day($0)) } // ≈108 NM
        XCTAssertEqual(evaluate(hops)[ID.regionalHopper]?.earnedAt, day(9))
        XCTAssertFalse(evaluate(Array(hops.prefix(9)))[ID.regionalHopper]?.isEarned ?? true)
        let pattern = (0..<10).map { record("LIRF", "LIRF", landed: day($0), distance: 30) }
        XCTAssertFalse(evaluate(pattern)[ID.regionalHopper]?.isEarned ?? true, "circuits do not count")
        let long = (0..<10).map { record("LIRF", "LIML", landed: day($0)) } // ≈ 260 NM → counts
        XCTAssertTrue(evaluate(long)[ID.regionalHopper]?.isEarned ?? false)
        let tooLong = (0..<10).map { record("LIRF", "EGLL", landed: day($0)) }
        XCTAssertFalse(evaluate(tooLong)[ID.regionalHopper]?.isEarned ?? true)
    }

    // MARK: ISO week

    func testISOWeekEdgeCases() throws {
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2026-10-02T09:00:00Z")).id, "2026-W40")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2026-12-31T23:59:59Z")).id, "2026-W53")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2027-01-01T00:00:00Z")).id, "2026-W53")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2027-01-03T23:59:59Z")).id, "2026-W53")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2027-01-04T00:00:00Z")).id, "2027-W01")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2020-12-31T12:00:00Z")).id, "2020-W53")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2021-01-03T12:00:00Z")).id, "2020-W53")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2008-12-29T00:00:00Z")).id, "2009-W01")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2026-01-01T00:00:00Z")).id, "2026-W01")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("2025-12-29T00:00:00Z")).id, "2026-W01")
        XCTAssertEqual(ISOWeek(containing: LogicFixtures.date("1969-12-31T00:00:00Z")).id, "1970-W01")

        let w53 = try XCTUnwrap(ISOWeek(year: 2020, week: 53))
        XCTAssertEqual(w53.start, LogicFixtures.date("2020-12-28T00:00:00Z"))
        XCTAssertEqual(w53.end, LogicFixtures.date("2021-01-04T00:00:00Z"))
        XCTAssertEqual(w53.next.id, "2021-W01")
        XCTAssertNil(ISOWeek(year: 2021, week: 53))
        XCTAssertNil(ISOWeek(year: 2026, week: 0))
        XCTAssertEqual(ISOWeek.weeksInYear(2026), 53)
        XCTAssertEqual(ISOWeek.weeksInYear(2027), 52)

        let w40 = try XCTUnwrap(ISOWeek(id: "2026-W40"))
        XCTAssertEqual(w40.start, LogicFixtures.date("2026-09-28T00:00:00Z"))
        XCTAssertEqual(w40.interval.duration, 7 * 86_400)
        XCTAssertEqual(w40.previous.id, "2026-W39")
        XCTAssertTrue(w40.contains(LogicFixtures.date("2026-10-04T23:59:59Z")))
        XCTAssertFalse(w40.contains(LogicFixtures.date("2026-10-05T00:00:00Z")))
        XCTAssertEqual(ISOWeek(id: "2026W05")?.id, "2026-W05")
        XCTAssertNil(ISOWeek(id: "garbage"))
        XCTAssertLessThan(try XCTUnwrap(ISOWeek(id: "2026-W53")), try XCTUnwrap(ISOWeek(id: "2027-W01")))
    }

    // MARK: Leaderboard and challenges

    func testWeeklyScore() {
        let records = [
            record("LIRF", "EGLL", landed: LogicFixtures.date("2026-09-25T12:00:00Z")), // previous week
            record("EGLL", "LIRF", landed: LogicFixtures.date("2026-09-29T03:00:00Z"), distance: 350), // night landing → Night Owl
            record("LIRF", "LIRN", landed: LogicFixtures.date("2026-10-01T12:00:00Z"), distance: 120),
            record("LIRN", "LIRF", landed: LogicFixtures.date("2026-10-02T12:00:00Z"), distance: 115, completed: false),
            record("LIRF", "LIML", landed: LogicFixtures.date("2026-10-05T00:30:00Z"), distance: 260), // next week
        ]
        let breakdown = LeaderboardScoring.breakdown(records: records, weekContaining: LogicFixtures.date("2026-10-02T09:00:00Z"),
                                                     airports: LogicFixtures.airport(_:))
        XCTAssertEqual(breakdown.week.id, "2026-W40")
        XCTAssertEqual(breakdown.flights, 2)
        XCTAssertEqual(breakdown.distanceNM, 470, accuracy: 1e-9)
        XCTAssertEqual(breakdown.badgesEarned, [ID.nightOwl])
        XCTAssertEqual(breakdown.total, 20 + 9 + 25)
        XCTAssertEqual(LeaderboardScoring.weeklyScore(records: records, weekContaining: LogicFixtures.date("2026-10-02T09:00:00Z"),
                                                      airports: LogicFixtures.airport(_:)), 54)
        // Previous week: 1 flight (780 NM → 15) + First Flight badge.
        XCTAssertEqual(LeaderboardScoring.weeklyScore(records: records, weekContaining: LogicFixtures.date("2026-09-24T00:00:00Z")), 10 + 15 + 25)
        XCTAssertEqual(LeaderboardScoring.weeklyScore(records: [], weekContaining: base), 0)
    }

    func testChallenges() throws {
        let now = LogicFixtures.date("2026-10-02T20:00:00Z")
        let records = [
            record("LIRF", "EGLL", landed: LogicFixtures.date("2026-09-28T10:00:00Z")),
            record("EGLL", "LFPG", landed: LogicFixtures.date("2026-09-30T10:00:00Z")),
            record("LFPG", "LIRF", landed: LogicFixtures.date("2026-10-01T02:00:00Z")),
            record("LIRF", "LEMD", landed: LogicFixtures.date("2026-10-03T10:00:00Z")), // after now
            record("LIRF", "LIML", landed: LogicFixtures.date("2026-09-20T10:00:00Z")), // previous week, same month
        ]
        let byID = Dictionary(uniqueKeysWithValues: ChallengeEngine.progress(records: records, airports: LogicFixtures.airport(_:), now: now)
            .map { ($0.challenge.id, $0) })
        let flights5 = try XCTUnwrap(byID["weekly.flights5"])
        XCTAssertEqual(flights5.current, 3)
        XCTAssertFalse(flights5.isCompleted)
        XCTAssertEqual(flights5.interval, ISOWeek(containing: now).interval)
        XCTAssertEqual(flights5.id, "weekly.flights5@2026-W40")
        XCTAssertEqual(flights5.timeRemaining(now: now), LogicFixtures.date("2026-10-05T00:00:00Z").timeIntervalSince(now))
        let countries = try XCTUnwrap(byID["weekly.countries3"])
        XCTAssertEqual(countries.current, 3) // GB, FR, IT
        XCTAssertEqual(countries.completedAt, LogicFixtures.date("2026-10-01T02:00:00Z"))
        XCTAssertEqual(byID["weekly.airports5"]?.current, 3)
        XCTAssertEqual(byID["weekly.night2"]?.current, 1)
        let monthly = try XCTUnwrap(byID["monthly.flights20"])
        XCTAssertEqual(monthly.current, 1, "only the 1 Oct landing is in October (before now)")
        XCTAssertEqual(monthly.interval.start, LogicFixtures.date("2026-10-01T00:00:00Z"))
        XCTAssertEqual(monthly.interval.end, LogicFixtures.date("2026-11-01T00:00:00Z"))
        let longest = try XCTUnwrap(byID["monthly.longhaul"])
        XCTAssertEqual(longest.current, Int(LogicFixtures.lfpg.position.distance(to: LogicFixtures.lirf.position)))
        XCTAssertFalse(longest.isCompleted)
        XCTAssertEqual(ChallengeCatalog.weekly.count + ChallengeCatalog.monthly.count, ChallengeCatalog.all.count)
    }
}
