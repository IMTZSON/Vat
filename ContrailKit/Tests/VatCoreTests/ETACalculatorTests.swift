import XCTest
@testable import VatCore

final class ETACalculatorTests: XCTestCase {
    let now = LogicFixtures.date("2026-10-02T09:00:00Z")
    let lirf = LogicFixtures.lirf, egll = LogicFixtures.egll

    /// LIRF → (Elba-ish) → (Geneva-ish) → EGLL, so the route is not a single great circle.
    lazy var route = ResolvedRoute(waypoints: [
        RouteResolver.waypoint(for: lirf),
        Waypoint(ident: "ELB", kind: .navaid, point: GeoPoint(latitude: 42.7, longitude: 10.4)),
        Waypoint(ident: "GVA", kind: .navaid, point: GeoPoint(latitude: 46.25, longitude: 6.13)),
        RouteResolver.waypoint(for: egll),
    ])

    func pilot(at p: GeoPoint, alt: Int = 36_000, gs: Int = 450, plan: FlightPlan? = nil) -> Pilot {
        LogicFixtures.pilot("BAW1", at: p, altitude: alt, gs: gs, plan: plan ?? LogicFixtures.plan("LIRF", "EGLL", tas: "N0450"))
    }

    func testCruiseMidRoute() throws {
        // Aircraft exactly on the 2nd leg, 40 % along it.
        let a = route.waypoints[1].point, b = route.waypoints[2].point
        let position = a.intermediate(to: b, fraction: 0.4)
        let eta = ETACalculator.estimate(pilot: pilot(at: position), route: route, arrival: egll, phase: .cruise, now: now)
        let expectedRemaining = position.distance(to: b) + b.distance(to: egll.position)
        XCTAssertEqual(eta.remainingDistanceNM, expectedRemaining, accuracy: 0.5)
        XCTAssertEqual(eta.method, .route)
        XCTAssertEqual(eta.confidence, .high)
        let expectedSeconds = (expectedRemaining - 120) / 450 * 3600 + 1_908.7
        XCTAssertEqual(try XCTUnwrap(eta.touchdown).timeIntervalSince(now), expectedSeconds, accuracy: 5)
        XCTAssertEqual(try XCTUnwrap(eta.onBlock).timeIntervalSince(try XCTUnwrap(eta.touchdown)), 180, accuracy: 0.01)
        XCTAssertEqual(eta.progress, 1 - expectedRemaining / route.totalDistanceNM, accuracy: 0.001)
        XCTAssertGreaterThan(eta.progress, 0.2)
        XCTAssertLessThan(eta.progress, 0.7)
    }

    func testSlowGroundspeedUsesFilledTASFloor() throws {
        // 75 % of filed TAS (450) = 337.5 > GS 300 during climb.
        let position = lirf.position.destination(bearing: 315, distanceNM: 40)
        let eta = ETACalculator.estimate(pilot: pilot(at: position, alt: 18_000, gs: 300), route: route, arrival: egll,
                                         phase: .climb, now: now)
        let r = eta.remainingDistanceNM
        XCTAssertEqual(try XCTUnwrap(eta.touchdown).timeIntervalSince(now), (r - 120) / 337.5 * 3600 + 120 / (180 - 280) * log(180.0 / 280) * 3600, accuracy: 5)
        XCTAssertEqual(eta.confidence, .medium)
    }

    func testDescentProfile() throws {
        let position = egll.position.destination(bearing: 135, distanceNM: 80)
        let simple = ResolvedRoute(waypoints: [RouteResolver.waypoint(for: lirf), RouteResolver.waypoint(for: egll)])
        let eta = ETACalculator.estimate(pilot: pilot(at: position, alt: 16_000, gs: 300), route: simple, arrival: egll,
                                         phase: .descent, now: now)
        XCTAssertEqual(eta.remainingDistanceNM, 80, accuracy: 1)
        // Profile 246.7 → 180 kt over 80 NM ≈ 1361 s.
        XCTAssertEqual(try XCTUnwrap(eta.touchdown).timeIntervalSince(now), 1_361, accuracy: 20)
        // A slower aircraft (GS 200) starts the profile at its own speed.
        let slow = ETACalculator.estimate(pilot: pilot(at: position, alt: 8_000, gs: 200), route: simple, arrival: egll,
                                          phase: .approach, now: now)
        XCTAssertGreaterThan(try XCTUnwrap(slow.touchdown), try XCTUnwrap(eta.touchdown))
    }

    func testOnGroundBeforeDepartureUsesFiledSchedule() throws {
        let plan = LogicFixtures.plan("LIRF", "EGLL", deptime: "1000", enroute: "0230")
        let p = pilot(at: lirf.position, alt: 15, gs: 0, plan: plan)
        let eta = ETACalculator.estimate(pilot: p, route: route, arrival: egll, phase: .preflight, now: now)
        XCTAssertEqual(eta.method, .filedSchedule)
        XCTAssertEqual(eta.confidence, .low)
        XCTAssertEqual(eta.touchdown, LogicFixtures.date("2026-10-02T12:30:00Z"))
        XCTAssertEqual(eta.onBlock, LogicFixtures.date("2026-10-02T12:33:00Z"))
        XCTAssertEqual(eta.progress, 0)
        // Late departure: never before now + en-route time.
        let late = ETACalculator.estimate(pilot: p, route: route, arrival: egll, phase: .taxiOut,
                                          now: LogicFixtures.date("2026-10-02T10:40:00Z"))
        XCTAssertEqual(late.touchdown, LogicFixtures.date("2026-10-02T13:10:00Z"))
        // No en-route time: no estimate.
        let noTimes = ETACalculator.estimate(pilot: pilot(at: lirf.position, alt: 15, gs: 0), route: route, arrival: egll,
                                             phase: .preflight, now: now)
        XCTAssertNil(noTimes.touchdown)
        XCTAssertEqual(noTimes.method, .unavailable)
    }

    func testArrivedAndLanded() {
        let arrived = ETACalculator.estimate(pilot: pilot(at: egll.position, alt: 83, gs: 0), route: route, arrival: egll,
                                             phase: .arrived, now: now)
        XCTAssertEqual(arrived.method, .arrived)
        XCTAssertEqual(arrived.progress, 1)
        XCTAssertNil(arrived.touchdown)
        XCTAssertNil(arrived.onBlock)
        let landed = ETACalculator.estimate(pilot: pilot(at: egll.position, alt: 83, gs: 25), route: route, arrival: egll,
                                            phase: .landed, now: now)
        XCTAssertEqual(landed.onBlock, now.addingTimeInterval(180))
    }

    func testNoRouteUsesGreatCircle() throws {
        let position = lirf.position.intermediate(to: egll.position, fraction: 0.5)
        let eta = ETACalculator.estimate(pilot: pilot(at: position), route: nil, arrival: egll, phase: .cruise, now: now,
                                         departure: lirf)
        XCTAssertEqual(eta.method, .greatCircle)
        XCTAssertEqual(eta.confidence, .medium)
        XCTAssertEqual(eta.remainingDistanceNM, position.distance(to: egll.position), accuracy: 1e-6)
        XCTAssertEqual(eta.progress, 0.5, accuracy: 0.01)
        XCTAssertNotNil(eta.touchdown)
        // No arrival at all → unavailable.
        XCTAssertEqual(ETACalculator.estimate(pilot: pilot(at: position), route: nil, arrival: nil, phase: .cruise, now: now), .unavailable)
    }

    func testZeroGroundspeedAirborne() throws {
        let position = lirf.position.intermediate(to: egll.position, fraction: 0.5)
        // GS 0 (paused) with filed TAS → TAS used, low confidence.
        let withTAS = ETACalculator.estimate(pilot: pilot(at: position, gs: 0), route: nil, arrival: egll, phase: .cruise, now: now)
        XCTAssertNotNil(withTAS.touchdown)
        XCTAssertEqual(withTAS.confidence, .low)
        // GS 0 and no filed TAS → no ETA.
        let none = ETACalculator.estimate(pilot: pilot(at: position, gs: 0, plan: LogicFixtures.plan("LIRF", "EGLL", tas: "")),
                                          route: nil, arrival: egll, phase: .cruise, now: now)
        XCTAssertNil(none.touchdown)
        XCTAssertEqual(none.method, .unavailable)
    }

    func testOffRouteFallsBackToGreatCircleFromPosition() throws {
        // 400 NM east of the route (diverting).
        let position = GeoPoint(latitude: 45, longitude: 16)
        let eta = ETACalculator.estimate(pilot: pilot(at: position), route: route, arrival: egll, phase: .cruise, now: now)
        XCTAssertEqual(eta.method, .offRoute)
        XCTAssertEqual(eta.confidence, .low)
        XCTAssertEqual(eta.remainingDistanceNM, position.distance(to: egll.position), accuracy: 1e-6)
        XCTAssertGreaterThanOrEqual(eta.progress, 0)
        XCTAssertLessThanOrEqual(eta.progress, 1)
    }

    func testMinimumLegIndexPreventsGoingBackwards() throws {
        // Out-and-back route: the return leg passes close to the outbound one.
        let a = Airport(icao: "AAAA", name: "A", latitude: 0, longitude: 0)
        let c = Airport(icao: "CCCC", name: "C", latitude: 0.5, longitude: 0)
        let route = ResolvedRoute(waypoints: [
            RouteResolver.waypoint(for: a),
            Waypoint(ident: "TURN", kind: .fix, point: GeoPoint(latitude: 0, longitude: 10)),
            RouteResolver.waypoint(for: c),
        ])
        let position = GeoPoint(latitude: 0.1, longitude: 3)
        let outbound = ETACalculator.estimate(pilot: pilot(at: position), route: route, arrival: c, phase: .cruise, now: now)
        XCTAssertEqual(outbound.legIndex, 0)
        let inbound = ETACalculator.estimate(pilot: pilot(at: position), route: route, arrival: c, phase: .cruise, now: now,
                                             minimumLegIndex: 1)
        XCTAssertEqual(inbound.legIndex, 1)
        XCTAssertLessThan(inbound.remainingDistanceNM, outbound.remainingDistanceNM / 2)
        XCTAssertEqual(inbound.remainingDistanceNM, position.distance(to: c.position), accuracy: 0.5)
    }

    func testRemainingNeverIncreasesAlongTheRoute() {
        // Fly the densified path: remaining distance is non-increasing (never jumps back to a previous leg).
        var previous = Double.infinity
        for p in route.densifiedPath(maxSegmentNM: 10) {
            let eta = ETACalculator.estimate(pilot: pilot(at: p), route: route, arrival: egll, phase: .cruise, now: now)
            XCTAssertLessThanOrEqual(eta.remainingDistanceNM, previous + 0.5)
            previous = eta.remainingDistanceNM
        }
        XCTAssertEqual(previous, 0, accuracy: 0.5)
    }
}
