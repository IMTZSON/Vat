import XCTest
@testable import VatCore

final class RouteParserAndResolverTests: XCTestCase {
    func coordinate(_ token: RouteToken) -> GeoPoint? {
        if case .coordinate(let p) = token { return p }
        return nil
    }

    func assertPoint(_ p: GeoPoint?, _ lat: Double, _ lon: Double, file: StaticString = #filePath, line: UInt = #line) {
        guard let p else { return XCTFail("nil coordinate", file: file, line: line) }
        XCTAssertEqual(p.latitude, lat, accuracy: 1e-6, file: file, line: line)
        XCTAssertEqual(p.longitude, lon, accuracy: 1e-6, file: file, line: line)
    }

    // MARK: Parser

    func testCoordinateFormats() {
        assertPoint(RouteParser.parseCoordinate("4530N01015E"), 45.5, 10.25)
        assertPoint(RouteParser.parseCoordinate("45N010E"), 45, 10)
        assertPoint(RouteParser.parseCoordinate("4530S07315W"), -45.5, -73.25)
        assertPoint(RouteParser.parseCoordinate("453030N0101530E"), 45.508333, 10.258333)
        assertPoint(RouteParser.parseCoordinate("N4530W07315"), 45.5, -73.25)
        assertPoint(RouteParser.parseCoordinate("N45W073"), 45, -73)
        assertPoint(RouteParser.parseCoordinate("S3352E15110"), -33.866667, 151.166667)
        // ARINC 424 NAT shorthand.
        assertPoint(RouteParser.parseCoordinate("5020N"), 50, -20)
        assertPoint(RouteParser.parseCoordinate("50N20"), 50, -120)
        assertPoint(RouteParser.parseCoordinate("5020E"), 50, 20)
        assertPoint(RouteParser.parseCoordinate("5020W"), -50, -20)
        assertPoint(RouteParser.parseCoordinate("5020S"), -50, 20)
        // Not coordinates.
        for s in ["NEBIX", "SEWAN", "RAVAL", "UM728", "N0450F350", "4590N01015E", "9530N01015E", "45N190E", "ABCDE"] {
            XCTAssertNil(RouteParser.parseCoordinate(s), s)
        }
        XCTAssertEqual(RouteParser.format(GeoPoint(latitude: 45.5, longitude: 10.25)), "4530N01015E")
        XCTAssertEqual(RouteParser.format(GeoPoint(latitude: -45, longitude: -73)), "45S073W")
    }

    func testTokenisesMixedRoute() {
        let tokens = RouteParser.parse("RAVAL1A RAVAL UM728 BOA DCT 4530N01015E 45N010E N4530W07315 5020N 50N20 4530N 01015E KOPAG IFR VFR SID STAR")
        XCTAssertEqual(tokens.count, 12, "IFR/VFR/SID/STAR are dropped")
        XCTAssertEqual(tokens[0], .sid("RAVAL1A"))
        XCTAssertEqual(tokens[1], .waypoint("RAVAL"))
        XCTAssertEqual(tokens[2], .airway("UM728"))
        XCTAssertEqual(tokens[3], .waypoint("BOA"))
        XCTAssertEqual(tokens[4], .direct)
        assertPoint(coordinate(tokens[5]), 45.5, 10.25)
        assertPoint(coordinate(tokens[6]), 45, 10)
        assertPoint(coordinate(tokens[7]), 45.5, -73.25)
        assertPoint(coordinate(tokens[8]), 50, -20)
        assertPoint(coordinate(tokens[9]), 50, -120)
        assertPoint(coordinate(tokens[10]), 45.5, 10.25) // split pair
        XCTAssertEqual(tokens[11], .waypoint("KOPAG"))
    }

    func testSpeedLevelGroups() {
        let tokens = RouteParser.parse("N0450F350 RAVAL/N0460F370 UL607 TOP/M078F390 LIRF/16L")
        XCTAssertEqual(tokens, [
            .speedLevel(SpeedLevel(raw: "N0450F350", speedKnots: 450, mach: nil, altitudeFt: 35_000)),
            .waypoint("RAVAL"),
            .speedLevel(SpeedLevel(raw: "N0460F370", speedKnots: 460, mach: nil, altitudeFt: 37_000)),
            .airway("UL607"),
            .waypoint("TOP"),
            .speedLevel(SpeedLevel(raw: "M078F390", speedKnots: 446, mach: 0.78, altitudeFt: 39_000)),
            .waypoint("LIRF"), // runway suffix ignored
        ])
        XCTAssertEqual(SpeedLevel("K0830S1130")?.altitudeFt, 37_073)
        XCTAssertEqual(SpeedLevel("K0830S1130")?.speedKnots, 448)
        XCTAssertEqual(SpeedLevel("N0120A045")?.altitudeFt, 4_500)
        XCTAssertNotNil(SpeedLevel("N0120VFR"))
        XCTAssertNil(SpeedLevel("NEBIX"))
        XCTAssertNil(SpeedLevel("N871"))
    }

    func testAirwaysAndProcedures() {
        for a in ["UM728", "L9", "Q35", "T161", "J80", "N871", "UL607", "Y3", "A1B"] {
            XCTAssertTrue(RouteParser.isAirway(a), a)
        }
        for a in ["RAVAL", "BOA", "RAVAL1A", "UMBAL", "12", "ABC123"] {
            XCTAssertFalse(RouteParser.isAirway(a), a)
        }
        for p in ["RAVAL1A", "CAMRN4", "BIBA2W", "ABBEY3A"] { XCTAssertTrue(RouteParser.isProcedure(p), p) }
        for p in ["RAVAL", "UL607", "AB1C", "RAVAL12"] { XCTAssertFalse(RouteParser.isProcedure(p), p) }

        // Airports at both ends: SID after the departure, STAR before the arrival.
        XCTAssertEqual(RouteParser.parse("LIRF RAVAL1A RAVAL UM728 BOA BOA1A LIML"), [
            .waypoint("LIRF"), .sid("RAVAL1A"), .waypoint("RAVAL"), .airway("UM728"), .waypoint("BOA"),
            .star("BOA1A"), .waypoint("LIML"),
        ])
        // FAA dotted notation.
        XCTAssertEqual(RouteParser.parse("KJFK.DEEZZ5.CANDR..J60..PSB.PSB1"), [
            .waypoint("KJFK"), .sid("DEEZZ5"), .waypoint("CANDR"), .airway("J60"), .waypoint("PSB"), .star("PSB1"),
        ])
        // A procedure-looking token in the middle stays a waypoint; empty route → no tokens.
        XCTAssertEqual(RouteParser.parse("ABC TOP5 DEF"), [.waypoint("ABC"), .waypoint("TOP5"), .waypoint("DEF")])
        XCTAssertEqual(RouteParser.parse("  "), [])
        XCTAssertEqual(RouteParser.parse("dct raval"), [.direct, .waypoint("RAVAL")])
    }

    // MARK: Resolver

    let navaids: [Waypoint] = [
        // "ABC" exists in Italy (on the way to Milan) and in the USA.
        Waypoint(ident: "ABC", kind: .navaid, point: GeoPoint(latitude: 43.6, longitude: 10.9)),
        Waypoint(ident: "ABC", kind: .navaid, point: GeoPoint(latitude: 40, longitude: -100)),
        Waypoint(ident: "XYZ", kind: .navaid, point: GeoPoint(latitude: 44.5, longitude: 10.0)),
        // Only far away.
        Waypoint(ident: "FAR", kind: .navaid, point: GeoPoint(latitude: 35, longitude: -80)),
        // Behind the departure (Sicily): huge detour for LIRF → LIML.
        Waypoint(ident: "BAK", kind: .navaid, point: GeoPoint(latitude: 37.5, longitude: 14.0)),
    ]

    func resolver() -> RouteResolver {
        RouteResolver(lookup: InMemoryWaypointLookup(navaids + LogicFixtures.airports.map(RouteResolver.waypoint(for:))))
    }

    func testResolvesAmbiguousIdentsNearestToPrevious() {
        let plan = LogicFixtures.plan("LIRF", "LIML", route: "N0450F360 RAVAL1A ABC UM728 XYZ DCT 4500N00930E BOA1A")
        let route = resolver().resolve(flightPlan: plan, departure: LogicFixtures.lirf, arrival: LogicFixtures.liml)
        XCTAssertEqual(route.waypoints.map(\.ident), ["LIRF", "ABC", "XYZ", "4500N00930E", "LIML"])
        XCTAssertEqual(route.waypoints[1].point.longitude, 10.9, accuracy: 1e-9, "Italian ABC chosen")
        XCTAssertFalse(route.isGreatCircleFallback)
        XCTAssertEqual(route.unresolvedIdents, [])
        let legs = zip(route.waypoints, route.waypoints.dropFirst()).reduce(0) { $0 + $1.0.point.distance(to: $1.1.point) }
        XCTAssertEqual(route.totalDistanceNM, legs, accuracy: 1e-6)
        XCTAssertEqual(route.cumulativeDistanceNM.last ?? 0, route.totalDistanceNM, accuracy: 1e-9)
    }

    func testRejectsFarAndBackwardsCandidates() {
        let plan = LogicFixtures.plan("LIRF", "LIML", route: "FAR BAK UNKNOWN XYZ")
        let route = resolver().resolve(flightPlan: plan, departure: LogicFixtures.lirf, arrival: LogicFixtures.liml)
        XCTAssertEqual(route.waypoints.map(\.ident), ["LIRF", "XYZ", "LIML"])
        XCTAssertEqual(route.unresolvedIdents, ["FAR", "BAK", "UNKNOWN"])
    }

    func testGreatCircleFallbackAndAirportIdentsInRoute() {
        let plan = LogicFixtures.plan("LIRF", "LIML", route: "LIRF UM728 L9 LIML")
        let route = resolver().resolve(flightPlan: plan, departure: LogicFixtures.lirf, arrival: LogicFixtures.liml)
        XCTAssertEqual(route.waypoints.map(\.ident), ["LIRF", "LIML"])
        XCTAssertTrue(route.isGreatCircleFallback)
        XCTAssertEqual(route.totalDistanceNM, LogicFixtures.lirf.position.distance(to: LogicFixtures.liml.position), accuracy: 1e-6)
        // Missing departure: route starts at first resolved point.
        let noDep = resolver().resolve(flightPlan: LogicFixtures.plan("ZZZZ", "LIML", route: "XYZ"), departure: nil, arrival: LogicFixtures.liml)
        XCTAssertEqual(noDep.waypoints.map(\.ident), ["XYZ", "LIML"])
    }

    func testNavlogTakesPriority() {
        let navlog = [
            Waypoint(ident: "RAVAL", kind: .fix, point: GeoPoint(latitude: 42.2, longitude: 11.7), plannedAltitudeFt: 20_000),
            Waypoint(ident: "ELB", kind: .navaid, point: GeoPoint(latitude: 42.7, longitude: 10.4)),
            Waypoint(ident: "LIML", kind: .airport, point: LogicFixtures.liml.position),
        ]
        let route = resolver().resolve(flightPlan: LogicFixtures.plan("LIRF", "LIML", route: "ABC XYZ"), navlog: navlog,
                                       departure: LogicFixtures.lirf, arrival: LogicFixtures.liml)
        XCTAssertEqual(route.waypoints.map(\.ident), ["LIRF", "RAVAL", "ELB", "LIML"])
        XCTAssertEqual(route.waypoints[1].plannedAltitudeFt, 20_000)
    }

    func testDensifiedPathAndPointAtDistance() throws {
        let route = resolver().resolve(flightPlan: LogicFixtures.plan("LIRF", "EGLL"), departure: LogicFixtures.lirf, arrival: LogicFixtures.egll)
        let path = route.densifiedPath(maxSegmentNM: 50)
        XCTAssertEqual(path.first, LogicFixtures.lirf.position)
        XCTAssertEqual(path.last?.latitude ?? 0, LogicFixtures.egll.latitude, accuracy: 1e-6)
        for (a, b) in zip(path, path.dropFirst()) { XCTAssertLessThanOrEqual(a.distance(to: b), 50.01) }
        let mid = try XCTUnwrap(route.point(atDistanceNM: route.totalDistanceNM / 2))
        XCTAssertEqual(mid.distance(to: LogicFixtures.lirf.position), route.totalDistanceNM / 2, accuracy: 0.5)
        XCTAssertEqual(route.point(atDistanceNM: -5), LogicFixtures.lirf.position)
        XCTAssertEqual(route.point(atDistanceNM: 1e6), LogicFixtures.egll.position)
    }

    func testProjectionPrefersLaterLegAndReportsOffset() throws {
        let route = ResolvedRoute(waypoints: [
            Waypoint(ident: "A", kind: .fix, point: GeoPoint(latitude: 0, longitude: 0)),
            Waypoint(ident: "B", kind: .fix, point: GeoPoint(latitude: 0, longitude: 10)),
            Waypoint(ident: "C", kind: .fix, point: GeoPoint(latitude: 10, longitude: 10)),
        ])
        let onSecond = try XCTUnwrap(route.project(GeoPoint(latitude: 5, longitude: 10.1)))
        XCTAssertEqual(onSecond.legIndex, 1)
        XCTAssertEqual(onSecond.offRouteNM, 6, accuracy: 0.5)
        XCTAssertEqual(onSecond.remainingNM, 300, accuracy: 3)
        let atB = try XCTUnwrap(route.project(GeoPoint(latitude: 0, longitude: 10)))
        XCTAssertEqual(atB.legIndex, 1, "tie at the junction goes to the later leg")
        XCTAssertEqual(atB.distanceAlongNM, 600, accuracy: 2)
        // Monotonic constraint.
        let constrained = try XCTUnwrap(route.project(GeoPoint(latitude: 0, longitude: 3), minimumLegIndex: 1))
        XCTAssertEqual(constrained.legIndex, 1)
    }
}
