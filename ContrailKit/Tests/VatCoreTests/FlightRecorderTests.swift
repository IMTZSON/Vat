import XCTest
@testable import VatCore

final class FlightRecorderTests: XCTestCase {
    let t0 = LogicFixtures.date("2026-10-02T08:00:00Z")
    let cid = 1_234_567

    func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    func pilot(_ p: GeoPoint, alt: Int, gs: Int, plan: FlightPlan? = LogicFixtures.plan("LIRF", "LIML"), callsign: String = "AZA123") -> Pilot {
        LogicFixtures.pilot(callsign, cid: cid, at: p, altitude: alt, gs: gs, plan: plan)
    }

    @discardableResult
    func observe(_ r: inout FlightRecorder, _ p: Pilot, _ minutes: Double) -> [FlightRecordEvent] {
        r.observe(p, at: at(minutes), airport: LogicFixtures.airport(_:), nearestAirport: LogicFixtures.nearest(_:))
    }

    func kinds(_ events: [FlightRecordEvent]) -> [String] {
        events.map {
            switch $0 {
            case .opened: "opened"
            case .tookOff: "tookOff"
            case .landed: "landed"
            case .closed: "closed"
            }
        }
    }

    func testFullFlightTakeoffAndLanding() throws {
        var r = FlightRecorder(cid: cid)
        let lirf = LogicFixtures.lirf.position, liml = LogicFixtures.liml.position
        XCTAssertEqual(kinds(observe(&r, pilot(lirf, alt: 15, gs: 0), 0)), ["opened"])
        XCTAssertEqual(kinds(observe(&r, pilot(lirf.destination(bearing: 90, distanceNM: 1), alt: 15, gs: 15), 5)), [])
        XCTAssertEqual(kinds(observe(&r, pilot(lirf.destination(bearing: 320, distanceNM: 3), alt: 1_500, gs: 170), 10)), ["tookOff"])
        let mid = lirf.intermediate(to: liml, fraction: 0.5)
        XCTAssertEqual(kinds(observe(&r, pilot(mid, alt: 36_000, gs: 450), 25)), [])
        let landEvents = observe(&r, pilot(liml.destination(bearing: 330, distanceNM: 0.5), alt: 360, gs: 30), 50)
        XCTAssertEqual(kinds(landEvents), ["landed"])
        XCTAssertEqual(kinds(observe(&r, pilot(liml, alt: 353, gs: 0), 55)), [])

        let record = try XCTUnwrap(r.current)
        XCTAssertEqual(record.callsign, "AZA123")
        XCTAssertEqual(record.departure, "LIRF")
        XCTAssertEqual(record.arrival, "LIML")
        XCTAssertEqual(record.aircraftType, "A320")
        XCTAssertEqual(record.firstSeen, at(0))
        XCTAssertEqual(record.lastSeen, at(55))
        XCTAssertEqual(record.takeoffAt, at(10))
        XCTAssertEqual(record.landedAt, at(50))
        XCTAssertEqual(record.landedAirport, "LIML")
        XCTAssertTrue(record.completed)
        XCTAssertEqual(record.maxAltitudeFt, 36_000)
        XCTAssertEqual(record.distanceFlownNM, lirf.distance(to: liml), accuracy: 15)
        XCTAssertNotNil(UUID(uuidString: record.id), "id is a UUID string")
        XCTAssertEqual(record.id, FlightRecord.makeID(cid: cid, callsign: "AZA123", firstSeen: at(0)), "deterministic")

        // New plan after landing → the record is closed and a new one opened.
        let next = observe(&r, pilot(liml, alt: 353, gs: 0, plan: LogicFixtures.plan("LIML", "LIRF")), 70)
        XCTAssertEqual(kinds(next), ["closed", "opened"])
        if case .closed(let closed)? = next.first {
            XCTAssertTrue(closed.completed)
            XCTAssertEqual(closed.landedAirport, "LIML")
        }
        XCTAssertEqual(r.current?.departure, "LIML")
        XCTAssertNil(r.current?.takeoffAt)
    }

    func testReconnectGapStartsNewFlight() {
        var r = FlightRecorder(cid: cid)
        let p = GeoPoint(latitude: 44, longitude: 11)
        XCTAssertEqual(kinds(observe(&r, pilot(p, alt: 30_000, gs: 450), 0)), ["opened"])
        XCTAssertEqual(kinds(observe(&r, pilot(p.destination(bearing: 0, distanceNM: 5), alt: 30_000, gs: 450), 20)), [], "20 min gap is fine")
        XCTAssertEqual(kinds(observe(&r, pilot(p.destination(bearing: 0, distanceNM: 10), alt: 30_000, gs: 450), 51)), ["closed", "opened"])
        // tick() closes after the gap when the CID is missing from the feed.
        XCTAssertEqual(kinds(r.tick(now: at(70))), [])
        XCTAssertEqual(kinds(r.tick(now: at(82))), ["closed"])
        XCTAssertNil(r.current)
    }

    func testCallsignChangeAndOtherCIDs() {
        var r = FlightRecorder(cid: cid)
        let p = LogicFixtures.lirf.position
        observe(&r, pilot(p, alt: 15, gs: 0), 0)
        XCTAssertEqual(kinds(observe(&r, pilot(p, alt: 15, gs: 0, callsign: "AZA124"), 1)), ["closed", "opened"])
        XCTAssertEqual(r.current?.callsign, "AZA124")
        var other = LogicFixtures.pilot("XXX1", cid: 42, at: p, altitude: 15, gs: 0)
        other.cid = 42
        XCTAssertEqual(kinds(r.observe(other, at: at(2), airport: LogicFixtures.airport(_:))), [])
        // Refiling before departure just updates the plan.
        XCTAssertEqual(kinds(observe(&r, pilot(p, alt: 15, gs: 0, plan: LogicFixtures.plan("LIRF", "EGLL"), callsign: "AZA124"), 3)), [])
        XCTAssertEqual(r.current?.arrival, "EGLL")
    }

    func testDiversionAndFirstSeenAirborne() throws {
        var r = FlightRecorder(cid: cid)
        // First seen airborne (app opened mid-flight): no take-off time but the landing still completes it.
        let enroute = GeoPoint(latitude: 45.0, longitude: 11.5)
        XCTAssertEqual(kinds(observe(&r, pilot(enroute, alt: 12_000, gs: 280), 0)), ["opened"])
        // Diverts to Venice: plan arrival changed while airborne → same record.
        XCTAssertEqual(kinds(observe(&r, pilot(enroute.destination(bearing: 60, distanceNM: 30), alt: 5_000, gs: 250,
                                               plan: LogicFixtures.plan("LIRF", "LIPZ")), 8)), [])
        let venice = LogicFixtures.lipz.position.destination(bearing: 40, distanceNM: 1)
        XCTAssertEqual(kinds(observe(&r, pilot(venice, alt: 10, gs: 35, plan: LogicFixtures.plan("LIRF", "LIPZ")), 20)), ["landed"])
        let record = try XCTUnwrap(r.current)
        XCTAssertNil(record.takeoffAt)
        XCTAssertEqual(record.arrival, "LIPZ")
        XCTAssertEqual(record.landedAirport, "LIPZ")
        XCTAssertTrue(record.completed)
    }

    func testLandingAtUnplannedAirportViaNearestLookup() throws {
        var r = FlightRecorder(cid: cid)
        let start = LogicFixtures.lirn.position.destination(bearing: 0, distanceNM: 40)
        observe(&r, pilot(start, alt: 8_000, gs: 250, plan: LogicFixtures.plan("LIRF", "LIML")), 0)
        // Lands at Napoli (not the filed arrival) — found by the nearest-airport lookup.
        let events = observe(&r, pilot(LogicFixtures.lirn.position, alt: 300, gs: 20, plan: LogicFixtures.plan("LIRF", "LIML")), 15)
        XCTAssertEqual(kinds(events), ["landed"])
        XCTAssertEqual(r.current?.landedAirport, "LIRN")
        // Taking off again after landing → new record.
        let again = observe(&r, pilot(LogicFixtures.lirn.position.destination(bearing: 0, distanceNM: 5), alt: 2_000, gs: 180,
                                      plan: LogicFixtures.plan("LIRF", "LIML")), 40)
        XCTAssertEqual(kinds(again), ["closed", "opened"])
        // Fast taxi (>= 40 kt) is not a landing.
        var fast = FlightRecorder(cid: cid)
        observe(&fast, pilot(start, alt: 8_000, gs: 250), 0)
        observe(&fast, pilot(LogicFixtures.lirn.position, alt: 300, gs: 45), 10)
        XCTAssertNil(fast.current?.landedAt)
    }

    func testRecorderIsCodable() throws {
        var r = FlightRecorder(cid: cid)
        observe(&r, pilot(LogicFixtures.lirf.position, alt: 15, gs: 0), 0)
        let decoded = try JSONDecoder().decode(FlightRecorder.self, from: JSONEncoder().encode(r))
        XCTAssertEqual(decoded, r)
    }
}
