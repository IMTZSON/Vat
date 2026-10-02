import XCTest
@testable import VatCore

final class FlightTrackAndPhaseTests: XCTestCase {
    let t0 = LogicFixtures.date("2026-10-02T10:00:00Z")

    // MARK: FlightTrack

    func point(_ i: Int, lat: Double = 45, lon: Double = 10, alt: Int = 10_000, gs: Int = 300, hdg: Int = 90, dt: TimeInterval = 15) -> TrackPoint {
        TrackPoint(time: t0.addingTimeInterval(Double(i) * dt), position: GeoPoint(latitude: lat, longitude: lon),
                   altitudeFt: alt, groundspeedKt: gs, headingDeg: hdg)
    }

    func testDeduplicationAndOrdering() {
        var track = FlightTrack()
        XCTAssertTrue(track.append(point(0)))
        XCTAssertFalse(track.append(point(1)), "unchanged within 60 s is skipped")
        XCTAssertFalse(track.append(point(0)), "same time is out of order")
        XCTAssertTrue(track.append(point(5)), "unchanged after ≥ 60 s is kept")
        XCTAssertTrue(track.append(point(6, alt: 10_500)), "changed altitude is kept")
        XCTAssertFalse(track.append(TrackPoint(time: t0.addingTimeInterval(200), position: GeoPoint(latitude: 99, longitude: 0),
                                               altitudeFt: 0, groundspeedKt: 0, headingDeg: 0)), "invalid position")
        XCTAssertEqual(track.count, 3)
    }

    func testDownsamplingKeepsStartAndRecentResolution() {
        var track = FlightTrack(maxPoints: 100)
        for i in 0..<1_000 {
            track.append(point(i, lon: 10 + Double(i) * 0.01, alt: 1_000 + i * 10))
        }
        XCTAssertLessThanOrEqual(track.count, 100)
        XCTAssertGreaterThan(track.count, 50)
        XCTAssertEqual(track.first?.time, t0, "first point preserved")
        XCTAssertEqual(track.last?.time, t0.addingTimeInterval(999 * 15))
        // Recent points keep full 15 s resolution.
        let tail = track.points.suffix(10)
        for (a, b) in zip(tail, tail.dropFirst()) { XCTAssertEqual(b.time.timeIntervalSince(a.time), 15, accuracy: 0.01) }
        // Strictly increasing times.
        for (a, b) in zip(track.points, track.points.dropFirst()) { XCTAssertLessThan(a.time, b.time) }
        // Distance accumulated on append is not affected by downsampling (~0.42 NM per 0.01° at 45°N).
        XCTAssertEqual(track.distanceFlownNM, 999 * GeoPoint(latitude: 45, longitude: 10).distance(to: GeoPoint(latitude: 45, longitude: 10.01)), accuracy: 1)
    }

    func testVerticalRate() {
        var track = FlightTrack()
        XCTAssertNil(track.verticalRateFpm())
        // Climb 2000 fpm: +500 ft every 15 s, over 4 minutes.
        for i in 0...16 { track.append(point(i, lon: 10 + Double(i) * 0.02, alt: 5_000 + i * 500)) }
        XCTAssertEqual(track.verticalRateFpm() ?? 0, 2_000, accuracy: 1)
        // Then level for 2 minutes.
        for i in 17...25 { track.append(point(i, lon: 10 + Double(i) * 0.02, alt: 13_000)) }
        XCTAssertEqual(track.verticalRateFpm() ?? 99, 0, accuracy: 1)
        // Sparse points (5 min apart) beyond the window fall back to the previous one within 2.5×.
        var sparse = FlightTrack()
        sparse.append(point(0, alt: 30_000))
        sparse.append(point(1, lon: 11, alt: 27_000, dt: 240))
        XCTAssertEqual(sparse.verticalRateFpm() ?? 0, -750, accuracy: 1)
    }

    func testTrackCodableRoundTrip() throws {
        var track = FlightTrack(maxPoints: 50)
        for i in 0..<20 { track.append(point(i, lon: 10 + Double(i) * 0.05)) }
        let decoded = try JSONDecoder().decode(FlightTrack.self, from: JSONEncoder().encode(track))
        XCTAssertEqual(decoded, track)
        XCTAssertEqual(decoded.distanceFlownNM, track.distanceFlownNM)
    }

    // MARK: Phases

    func phase(_ p: GeoPoint, alt: Int, gs: Int, vs: Double?, dep: Airport? = LogicFixtures.lirf, arr: Airport? = LogicFixtures.liml,
               cruise: Int? = 36_000) -> FlightPhase {
        FlightPhaseDetector.phase(pilot: LogicFixtures.pilot(at: p, altitude: alt, gs: gs), departure: dep, arrival: arr,
                                  verticalRateFpm: vs, filedCruiseFt: cruise)
    }

    func testEveryPhase() {
        let lirf = LogicFixtures.lirf.position, liml = LogicFixtures.liml.position
        XCTAssertEqual(phase(lirf, alt: 15, gs: 0, vs: nil), .preflight)
        XCTAssertEqual(phase(lirf.destination(bearing: 90, distanceNM: 1), alt: 15, gs: 15, vs: 0), .taxiOut)
        XCTAssertEqual(phase(lirf, alt: 20, gs: 130, vs: 0), .takeoff, "take-off roll")
        XCTAssertEqual(phase(lirf.destination(bearing: 250, distanceNM: 3), alt: 900, gs: 160, vs: 2_500), .takeoff)
        XCTAssertEqual(phase(lirf.destination(bearing: 320, distanceNM: 60), alt: 15_000, gs: 330, vs: 2_000), .climb)
        let mid = lirf.intermediate(to: liml, fraction: 0.5)
        XCTAssertEqual(phase(mid, alt: 36_000, gs: 460, vs: 0), .cruise)
        XCTAssertEqual(phase(mid, alt: 35_100, gs: 460, vs: nil), .cruise, "within the filed band without VS")
        XCTAssertEqual(phase(mid, alt: 24_000, gs: 460, vs: 50, cruise: nil), .cruise, "level above FL100")
        XCTAssertEqual(phase(liml.destination(bearing: 150, distanceNM: 80), alt: 20_000, gs: 380, vs: -1_800), .descent)
        XCTAssertEqual(phase(liml.destination(bearing: 150, distanceNM: 15), alt: 3_000, gs: 180, vs: -800), .approach)
        XCTAssertEqual(phase(liml.destination(bearing: 150, distanceNM: 0.5), alt: 360, gs: 30, vs: 0), .landed)
        XCTAssertEqual(phase(liml.destination(bearing: 150, distanceNM: 0.5), alt: 360, gs: 120, vs: 0), .landed, "rollout")
        XCTAssertEqual(phase(liml, alt: 353, gs: 0, vs: nil), .arrived)
        XCTAssertEqual(phase(GeoPoint(latitude: 30, longitude: 30), alt: 5_000, gs: 200, vs: nil, dep: nil, arr: nil, cruise: nil), .unknown)
        XCTAssertEqual(phase(GeoPoint(latitude: 30, longitude: 30), alt: 35_000, gs: 450, vs: nil, dep: nil, arr: nil, cruise: nil), .cruise)
    }

    func testPhaseEdgeCases() {
        let lirf = LogicFixtures.lirf.position, liml = LogicFixtures.liml.position
        // High-elevation airport: AGL from elevation, gs < 35 near airport → ground even if MSL is high.
        XCTAssertEqual(phase(LogicFixtures.lemd.position, alt: 2_000, gs: 0, vs: nil, dep: LogicFixtures.lemd, arr: LogicFixtures.lirf), .preflight)
        // Without vertical rate: position decides climb vs descent.
        XCTAssertEqual(phase(lirf.intermediate(to: liml, fraction: 0.2), alt: 9_000, gs: 300, vs: nil), .climb)
        XCTAssertEqual(phase(lirf.intermediate(to: liml, fraction: 0.8), alt: 9_000, gs: 300, vs: nil), .descent)
        // Go-around near the arrival while climbing is not "approach".
        XCTAssertEqual(phase(liml.destination(bearing: 0, distanceNM: 5), alt: 2_500, gs: 160, vs: 2_000), .climb)
        // Diverted and parked far from both: arrived.
        XCTAssertEqual(phase(LogicFixtures.lipz.position, alt: 7, gs: 0, vs: nil), .arrived)
        // Symbol and title present for each phase.
        for p in FlightPhase.allCases {
            XCTAssertFalse(p.symbolName.isEmpty)
            XCTAssertFalse(p.title.isEmpty)
        }
        XCTAssertTrue(FlightPhase.cruise.isAirborne)
        XCTAssertTrue(FlightPhase.arrived.isOnGround)
    }

    func testGroundState() {
        let p = LogicFixtures.lirf.position
        XCTAssertEqual(GroundState.of(pilot: LogicFixtures.pilot(at: p, altitude: 15, gs: 0), airportElevationFt: 15), .atGate)
        XCTAssertEqual(GroundState.of(pilot: LogicFixtures.pilot(at: p, altitude: 15, gs: 18), airportElevationFt: 15), .taxiing)
        XCTAssertEqual(GroundState.of(pilot: LogicFixtures.pilot(at: p, altitude: 3_000, gs: 180), airportElevationFt: 15), .airborne)
        XCTAssertEqual(GroundState.of(pilot: LogicFixtures.pilot(at: p, altitude: 2_010, gs: 10), airportElevationFt: 1_998), .taxiing)
    }

    func testFlightProgressSummary() throws {
        let plan = LogicFixtures.plan("LIRF", "LIML", deptime: "0930", enroute: "0110")
        let mid = LogicFixtures.lirf.position.intermediate(to: LogicFixtures.liml.position, fraction: 0.5)
        let pilot = LogicFixtures.pilot("AZA1", at: mid, altitude: 36_000, gs: 450, plan: plan)
        let summary = FlightProgressSummary.make(pilot: pilot, departure: LogicFixtures.lirf, arrival: LogicFixtures.liml,
                                                 verticalRateFpm: 0, now: t0)
        XCTAssertEqual(summary.phase, .cruise)
        XCTAssertEqual(summary.progress, 0.5, accuracy: 0.01)
        XCTAssertNotNil(summary.eta)
        XCTAssertEqual(summary.departure, "LIRF")
        let data = try JSONEncoder().encode(summary)
        XCTAssertEqual(try JSONDecoder().decode(FlightProgressSummary.self, from: data), summary)
    }
}
