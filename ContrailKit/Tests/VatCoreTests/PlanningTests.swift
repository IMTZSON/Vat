import XCTest
@testable import VatCore

final class PlanningTests: XCTestCase {
    let now = LogicFixtures.date("2026-10-02T18:00:00Z")

    // MARK: RouteTimeline

    func testPlannedTimeline() throws {
        let route = ResolvedRoute(waypoints: [
            RouteResolver.waypoint(for: LogicFixtures.lirf),
            Waypoint(ident: "GVA", kind: .navaid, point: GeoPoint(latitude: 46.25, longitude: 6.13)),
            RouteResolver.waypoint(for: LogicFixtures.egll),
        ])
        let timeline = RouteTimeline(route: route, departureTime: now, cruiseTASKnots: 450)
        let profile = SpeedProfile(cruiseKt: 450)
        let expectedDuration = profile.timeFromStart(toDistance: route.totalDistanceNM, total: route.totalDistanceNM)
        // Climb 150 NM 250→450 (1587 s) + cruise + descent 120 NM 280→180 (1909 s).
        XCTAssertEqual(expectedDuration, 1_587.2 + (route.totalDistanceNM - 270) / 450 * 3600 + 1_908.7, accuracy: 2)
        XCTAssertEqual(timeline.entries.count, 3)
        XCTAssertEqual(timeline.entries[0].time, now)
        XCTAssertEqual(timeline.entries[2].time.timeIntervalSince(now), expectedDuration, accuracy: 0.5)
        XCTAssertEqual(timeline.duration, expectedDuration, accuracy: 0.5)
        XCTAssertLessThan(timeline.entries[0].time, timeline.entries[1].time)
        XCTAssertEqual(timeline.waypointTimes.map(\.waypoint.ident), ["LIRF", "GVA", "EGLL"])

        XCTAssertEqual(try XCTUnwrap(timeline.point(at: now)).distance(to: LogicFixtures.lirf.position), 0, accuracy: 0.1)
        XCTAssertEqual(try XCTUnwrap(timeline.point(at: try XCTUnwrap(timeline.end))).distance(to: LogicFixtures.egll.position), 0, accuracy: 0.1)
        XCTAssertNil(timeline.point(at: now.addingTimeInterval(-60)))
        XCTAssertNil(timeline.point(at: now.addingTimeInterval(expectedDuration + 60)))
        // One hour in: climb (≈1587 s for 150 NM) then cruise at 450 kt → ≈ 150 + 2013/3600×450 ≈ 401 NM.
        let d = try XCTUnwrap(timeline.distance(at: now.addingTimeInterval(3_600)))
        XCTAssertEqual(d, 150 + (3_600 - 1_587.2) / 3600 * 450, accuracy: 2)
        // Inverse consistency.
        let t = try XCTUnwrap(timeline.time(atDistanceNM: d))
        XCTAssertEqual(t.timeIntervalSince(now), 3_600, accuracy: 5)
        // Monotonic samples.
        for (a, b) in zip(timeline.samples, timeline.samples.dropFirst()) {
            XCTAssertLessThan(a.distanceNM, b.distanceNM)
            XCTAssertLessThanOrEqual(a.time, b.time)
        }
    }

    func testPlannedTimelineFromFlightPlanScalesToFiledTime() throws {
        let route = ResolvedRoute(waypoints: [RouteResolver.waypoint(for: LogicFixtures.lirf), RouteResolver.waypoint(for: LogicFixtures.egll)])
        let plan = LogicFixtures.plan("LIRF", "EGLL", tas: "N0450", deptime: "1830", enroute: "0215")
        let timeline = RouteTimeline(route: route, flightPlan: plan, now: now)
        XCTAssertEqual(timeline.start, LogicFixtures.date("2026-10-02T18:30:00Z"))
        XCTAssertEqual(try XCTUnwrap(timeline.end).timeIntervalSince(try XCTUnwrap(timeline.start)), 2 * 3600 + 15 * 60, accuracy: 1)
    }

    func testLiveTimelineMatchesETA() throws {
        let route = ResolvedRoute(waypoints: [
            RouteResolver.waypoint(for: LogicFixtures.lirf),
            Waypoint(ident: "GVA", kind: .navaid, point: GeoPoint(latitude: 46.25, longitude: 6.13)),
            RouteResolver.waypoint(for: LogicFixtures.egll),
        ])
        let position = route.waypoints[0].point.intermediate(to: route.waypoints[1].point, fraction: 0.6)
        let pilot = LogicFixtures.pilot("BAW2", at: position, altitude: 37_000, gs: 470, plan: LogicFixtures.plan("LIRF", "EGLL"))
        let eta = ETACalculator.estimate(pilot: pilot, route: route, arrival: LogicFixtures.egll, phase: .cruise, now: now)
        let timeline = RouteTimeline(route: route, aircraft: position, groundspeedKt: 470, filedTASKt: 450, now: now)
        XCTAssertEqual(timeline.entries.map(\.waypoint.ident), ["AIRCRAFT", "GVA", "EGLL"])
        XCTAssertEqual(timeline.entries[0].time, now)
        XCTAssertEqual(try XCTUnwrap(timeline.end).timeIntervalSince(try XCTUnwrap(eta.touchdown)), 0, accuracy: 2)
        // Scaled to an external estimate (e.g. with winds).
        var later = eta
        later.touchdown = eta.touchdown?.addingTimeInterval(600)
        let scaled = RouteTimeline(route: route, aircraft: position, groundspeedKt: 470, filedTASKt: 450, now: now, estimate: later)
        XCTAssertEqual(try XCTUnwrap(scaled.end).timeIntervalSince(try XCTUnwrap(later.touchdown)), 0, accuracy: 0.01)
    }

    // MARK: ATC coverage

    /// Equator route lon 0 → 30 (≈1800 NM, ≈4.2 h at 450 kt).
    func equatorTimeline() -> RouteTimeline {
        let route = ResolvedRoute(waypoints: [
            Waypoint(ident: "A", kind: .fix, point: GeoPoint(latitude: 0, longitude: 0)),
            Waypoint(ident: "B", kind: .fix, point: GeoPoint(latitude: 0, longitude: 30)),
        ])
        return RouteTimeline(route: route, departureTime: now, cruiseTASKnots: 450)
    }

    func box(_ id: String, kind: AirspaceVolume.Kind, prefix: String, lon: ClosedRange<Double>, lat: Double = 5) -> AirspaceVolume {
        let polygon = GeoPolygon(outer: [
            GeoPoint(latitude: -lat, longitude: lon.lowerBound), GeoPoint(latitude: -lat, longitude: lon.upperBound),
            GeoPoint(latitude: lat, longitude: lon.upperBound), GeoPoint(latitude: lat, longitude: lon.lowerBound),
        ])
        return AirspaceVolume(id: id, kind: kind, name: id, callsignPrefixes: [prefix],
                              geometry: GeoMultiPolygon(polygons: [polygon]), center: polygon.centroid)
    }

    lazy var volumes: [AirspaceVolume] = [
        box("UIR:UUUU", kind: .uir, prefix: "UUUU", lon: -1...31, lat: 6),
        box("FIR:AAAA", kind: .fir, prefix: "AAAA", lon: -1...10),
        box("FIR:BBBB", kind: .fir, prefix: "BBBB", lon: 10...20),
        box("FIR:EEEE", kind: .fir, prefix: "EEEE", lon: 20...31),
        AirspaceVolume(id: "TRACON:CCC", kind: .tracon, name: "CCC", callsignPrefixes: ["CCC"],
                       center: GeoPoint(latitude: 0, longitude: 2), radiusNM: 40),
        AirspaceVolume(id: "APT:ZZZZ", kind: .airport, name: "ZZZZ", callsignPrefixes: ["ZZZZ"],
                       center: GeoPoint(latitude: 0, longitude: 5), radiusNM: 10),
        // Far away: filtered out by bounds.
        box("FIR:FARR", kind: .fir, prefix: "FARR", lon: 100...110),
    ]

    func controller(_ callsign: String, facility: Facility) -> Controller {
        Controller(cid: 1, callsign: callsign, frequency: "128.000", facility: facility)
    }

    func testCoverageForecastSegments() throws {
        let timeline = equatorTimeline()
        let online = [controller("AAAA_CTR", facility: .center), controller("CCC_APP", facility: .approach),
                      controller("EEEE_CTR", facility: .center), controller("XXXX_OBS", facility: .observer)]
        let bookings = [ATCBooking(id: 1, callsign: "BBBB_CTR", start: now.addingTimeInterval(3_600), end: now.addingTimeInterval(5 * 3_600))]
        let matcher = ATCCoverageForecast.prefixMatcher(volumes: volumes)
        let segments = ATCCoverageForecast.forecast(timeline: timeline, volumes: volumes, online: online, bookings: bookings,
                                                    now: now, matcher: matcher)
        XCTAssertEqual(segments.map(\.volume.id), ["FIR:AAAA", "TRACON:CCC", "FIR:AAAA", "FIR:BBBB", "FIR:EEEE"])
        XCTAssertEqual(segments.map(\.state), [.online, .online, .online, .booked, .offline])
        XCTAssertEqual(segments[0].controllerCallsign, "AAAA_CTR")
        XCTAssertEqual(segments[1].controllerCallsign, "CCC_APP")
        XCTAssertEqual(segments[3].booking?.callsign, "BBBB_CTR")
        XCTAssertNil(segments[4].controllerCallsign, "EEEE passage is > 2 h ahead: online-now does not count")
        // Boundaries: TRACON circle spans lon 2 ± 40 NM, BBBB starts at lon 10 (≈ 600.4 NM).
        XCTAssertEqual(segments[1].entryDistanceNM, 120.1 - 40, accuracy: 1)
        XCTAssertEqual(segments[1].exitDistanceNM, 120.1 + 40, accuracy: 1)
        XCTAssertEqual(segments[3].entryDistanceNM, 600.4, accuracy: 1)
        XCTAssertEqual(segments[4].entryDistanceNM, 1_200.8, accuracy: 1)
        // Contiguous and ordered in time, covering the whole flight.
        XCTAssertEqual(segments.first?.entry, timeline.start)
        XCTAssertEqual(segments.last?.exit, timeline.end)
        for (a, b) in zip(segments, segments.dropFirst()) { XCTAssertEqual(a.exit, b.entry) }
        // Time-based coverage: online up to lon 10 (≈ 600 NM of 1800, but climb is slower).
        let online1 = ATCCoverageForecast.coveragePercent(segments, timeline: timeline)
        let expected = try XCTUnwrap(timeline.time(atDistanceNM: 600.4)).timeIntervalSince(now) / timeline.duration
        XCTAssertEqual(online1, expected, accuracy: 0.01)
        XCTAssertGreaterThan(ATCCoverageForecast.coveragePercent(segments, timeline: timeline, counting: [.online, .booked]), online1)
    }

    func testCoverageBookingConfirmsLaterOnlineAndTopDownService() throws {
        let timeline = equatorTimeline()
        // CCC_APP offline: the online FIR above covers it (no separate TRACON segment).
        let online = [controller("AAAA_CTR", facility: .center), controller("EEEE_CTR", facility: .center)]
        // EEEE_CTR is online now and booked until well after the passage → online.
        let bookings = [ATCBooking(id: 2, callsign: "EEEE_CTR", start: now.addingTimeInterval(-3_600), end: now.addingTimeInterval(6 * 3_600))]
        let segments = ATCCoverageForecast.forecast(timeline: timeline, volumes: volumes, online: online, bookings: bookings,
                                                    now: now, matcher: ATCCoverageForecast.prefixMatcher(volumes: volumes))
        XCTAssertEqual(segments.map(\.volume.id), ["FIR:AAAA", "FIR:BBBB", "FIR:EEEE"])
        XCTAssertEqual(segments.map(\.state), [.online, .offline, .online])
        XCTAssertEqual(segments[2].booking?.id, 2)
        // Nothing staffed and no volumes intersecting → empty.
        XCTAssertTrue(ATCCoverageForecast.forecast(timeline: timeline, volumes: [volumes.last!], online: [], bookings: [],
                                                   now: now, matcher: { _ in [] }).isEmpty)
    }

    func testPrefixMatcher() {
        let matcher = ATCCoverageForecast.prefixMatcher(volumes: volumes)
        XCTAssertEqual(matcher("AAAA_CTR"), ["FIR:AAAA"])
        XCTAssertEqual(matcher("CCC_APP"), ["TRACON:CCC"])
        XCTAssertEqual(matcher("ZZZZ_TWR"), ["APT:ZZZZ"])
        XCTAssertEqual(matcher("ZZZZ_CTR"), [])
        XCTAssertEqual(matcher("UUUU_E_CTR"), ["UIR:UUUU"])
    }

    // MARK: Traffic

    func testTrafficForecastBuckets() throws {
        let italy = AirspaceVolume(
            id: "FIR:LIRR", kind: .fir, name: "Roma", callsignPrefixes: ["LIRR"],
            geometry: GeoMultiPolygon(polygons: [GeoPolygon(outer: [
                GeoPoint(latitude: 36, longitude: 7), GeoPoint(latitude: 36, longitude: 19),
                GeoPoint(latitude: 44.5, longitude: 19), GeoPoint(latitude: 44.5, longitude: 7),
            ])]),
            center: GeoPoint(latitude: 40, longitude: 13)
        )
        let inbound = GeoPoint(latitude: 46, longitude: 9)
        let pilots = [
            LogicFixtures.pilot("ARR1", at: inbound, altitude: 36_000, gs: 450, plan: LogicFixtures.plan("EGLL", "LIRF")),
            LogicFixtures.pilot("DEP1", at: LogicFixtures.lirf.position, altitude: 15, gs: 0, plan: LogicFixtures.plan("LIRF", "EGLL", deptime: "1840")),
            LogicFixtures.pilot("OVR1", at: GeoPoint(latitude: 46, longitude: 13), altitude: 37_000, gs: 450, plan: LogicFixtures.plan("EDDF", "LGAV")),
            LogicFixtures.pilot("FAR1", at: GeoPoint(latitude: 40, longitude: -95), altitude: 35_000, gs: 450, plan: LogicFixtures.plan("KJFK", "KLAX")),
            LogicFixtures.pilot("LND1", at: LogicFixtures.lirf.position, altitude: 15, gs: 10, plan: LogicFixtures.plan("EGLL", "LIRF")),
            LogicFixtures.pilot("ARR2", at: GeoPoint(latitude: 50, longitude: 0), altitude: 36_000, gs: 450, plan: LogicFixtures.plan("EGLL", "LIRN")),
        ]
        let prefiles = [Prefile(cid: 9, callsign: "PRE1", flightPlan: LogicFixtures.plan("LIRA", "LEMD", deptime: "2015"))]
        let forecast = TrafficLoadForecast.forecast(
            volume: italy, pilots: pilots, prefiles: prefiles, airports: LogicFixtures.airport(_:), now: now,
            horizonHours: 4, bucketMinutes: 30, etaByCallsign: ["ARR2": now.addingTimeInterval(3 * 3600 + 600)]
        )
        XCTAssertEqual(forecast.buckets.count, 8)
        XCTAssertEqual(forecast.buckets[0].start, now)
        XCTAssertEqual(forecast.buckets[7].end, now.addingTimeInterval(4 * 3600))
        let summary = forecast.buckets.map { [$0.arrivals, $0.departures, $0.overflights] }
        XCTAssertEqual(summary, [[0, 0, 1], [1, 1, 0], [0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [0, 0, 0]])
        XCTAssertEqual(forecast.totalMovements, 5)
        XCTAssertEqual(forecast.peak?.start, forecast.buckets[1].start)
        XCTAssertEqual(forecast.peakLevel, .quiet)
        XCTAssertEqual(TrafficLevel(total: 4), .quiet)
        XCTAssertEqual(TrafficLevel(total: 5), .moderate)
        XCTAssertEqual(TrafficLevel(total: 15), .busy)
        XCTAssertEqual(TrafficLevel(total: 30), .veryBusy)
        XCTAssertEqual(TrafficLevel(total: 8, thresholds: .airport), .busy)
        XCTAssertLessThan(TrafficLevel.quiet, TrafficLevel.veryBusy)
    }

    // MARK: Tonight planner

    func makePlanner(window: DateInterval) -> TonightPlanner {
        let online: [String: Set<ATCPosition>] = [
            "LIRF": [.approach, .tower, .ground], "EGLL": [.tower, .atis], "LIML": [.delivery], "ZZZZ": [.tower],
        ]
        let bookings = [
            ATCBooking(id: 1, callsign: "EDDF_TWR", start: LogicFixtures.date("2026-10-02T18:30:00Z"), end: LogicFixtures.date("2026-10-02T21:00:00Z")),
            ATCBooking(id: 2, callsign: "EDDF_APP", start: LogicFixtures.date("2026-10-02T19:00:00Z"), end: LogicFixtures.date("2026-10-02T21:00:00Z")),
            ATCBooking(id: 3, callsign: "LIRF_TWR", start: LogicFixtures.date("2026-10-02T18:00:00Z"), end: LogicFixtures.date("2026-10-02T22:00:00Z")),
            ATCBooking(id: 4, callsign: "LOWW_TWR", start: LogicFixtures.date("2026-10-02T23:00:00Z"), end: LogicFixtures.date("2026-10-03T01:00:00Z")),
        ]
        let events = [VatsimEvent(id: 77, name: "Paris Night", airports: ["LFPG"],
                                  routes: [VatsimEvent.Route(departure: "LFPG", arrival: "LIRF")],
                                  start: LogicFixtures.date("2026-10-02T19:00:00Z"), end: LogicFixtures.date("2026-10-02T22:00:00Z"))]
        let pilots = (0..<3).map {
            LogicFixtures.pilot("DLA\($0)", at: LogicFixtures.liml.position, altitude: 353, gs: 0, plan: LogicFixtures.plan("LIML", "EGLL"))
        }
        return TonightPlanner(
            airports: LogicFixtures.airports, onlinePositions: online,
            coverage: { p in (41...43).contains(p.latitude) && (11...13).contains(p.longitude) ? .online : .offline },
            bookings: bookings, events: events, pilots: pilots, window: window, now: LogicFixtures.date("2026-10-02T17:00:00Z")
        )
    }

    func testTonightPlannerRanksAirports() throws {
        let window = DateInterval(start: LogicFixtures.date("2026-10-02T18:00:00Z"), end: LogicFixtures.date("2026-10-02T22:00:00Z"))
        let suggestions = makePlanner(window: window).suggestions()
        XCTAssertEqual(suggestions.map(\.icao), ["LIRF", "LFPG", "EGLL", "EDDF", "LIML"])
        let lirf = suggestions[0]
        XCTAssertEqual(lirf.score, 7 + 6 + 2, accuracy: 1e-9) // APP+TWR+GND, event route, enroute CTR
        XCTAssertEqual(lirf.coverageState, .online)
        XCTAssertTrue(lirf.isFeatured)
        XCTAssertEqual(lirf.reasons.first, .atcOnline([.ground, .tower, .approach]))
        XCTAssertTrue(lirf.reasons.contains(.event(name: "Paris Night", id: 77)))
        XCTAssertTrue(lirf.reasons.contains(.enrouteCoverage(.online)))
        XCTAssertFalse(lirf.reasons.contains { if case .atcBooked = $0 { true } else { false } }, "already online")

        XCTAssertEqual(suggestions[1].score, 6, accuracy: 1e-9)
        XCTAssertEqual(suggestions[1].coverageState, .offline)
        XCTAssertEqual(suggestions[2].score, 3 + 2, accuracy: 1e-9) // TWR+ATIS, log2(1+3) traffic
        XCTAssertTrue(suggestions[2].reasons.contains(.traffic(count: 3)))
        let eddf = suggestions[3]
        XCTAssertEqual(eddf.score, (2.5 + 3) * 0.7, accuracy: 1e-9)
        XCTAssertEqual(eddf.reasons, [.atcBooked([.tower, .approach], from: LogicFixtures.date("2026-10-02T18:30:00Z"))])
        XCTAssertEqual(eddf.coverageState, .booked)
        XCTAssertEqual(suggestions[4].score, 1 + 2, accuracy: 1e-9)
        XCTAssertFalse(suggestions.contains { $0.icao == "LOWW" || $0.icao == "ZZZZ" })
        XCTAssertEqual(makePlanner(window: window).suggestions(limit: 2).count, 2)
    }

    func testTonightPlannerIgnoresOnlineATCForFarWindow() {
        let tomorrow = DateInterval(start: LogicFixtures.date("2026-10-03T18:00:00Z"), end: LogicFixtures.date("2026-10-03T22:00:00Z"))
        let suggestions = makePlanner(window: tomorrow).suggestions()
        XCTAssertFalse(suggestions.contains { s in s.reasons.contains { if case .atcOnline = $0 { true } else { false } } })
        XCTAssertFalse(suggestions.contains { $0.icao == "EDDF" }, "bookings outside the window")
    }

    func testTonightPlannerRoutes() throws {
        let window = DateInterval(start: LogicFixtures.date("2026-10-02T18:00:00Z"), end: LogicFixtures.date("2026-10-02T22:00:00Z"))
        let routes = makePlanner(window: window).routes(limit: 5)
        let top = try XCTUnwrap(routes.first)
        XCTAssertEqual(top.id, "LFPG-LIRF", "event route keeps the event direction")
        XCTAssertTrue(top.reasons.contains(.eventRoute(name: "Paris Night", id: 77)))
        XCTAssertEqual(top.score, 6 + 15 + 8, accuracy: 1e-9)
        XCTAssertEqual(top.distanceNM, LogicFixtures.lfpg.position.distance(to: LogicFixtures.lirf.position), accuracy: 1e-6)
        XCTAssertGreaterThan(top.estimatedDuration, top.distanceNM / 450 * 3600)
        let second = try XCTUnwrap(routes.dropFirst().first)
        XCTAssertTrue(second.reasons.contains(.bothEndsCovered))
        for r in routes {
            XCTAssertTrue((150...2_500).contains(r.distanceNM))
            XCTAssertNotEqual(r.from, r.to)
        }
        XCTAssertLessThanOrEqual(routes.filter { $0.from == "LIRF" || $0.to == "LIRF" }.count, 3)
        XCTAssertEqual(Set(routes.map { [$0.from, $0.to].sorted().joined() }).count, routes.count, "no duplicate pairs")
        // Distance filter.
        XCTAssertTrue(makePlanner(window: window).routes(distanceRange: 10_000...20_000).allSatisfy { $0.reasons.contains(.eventRoute(name: "Paris Night", id: 77)) })
    }
}
