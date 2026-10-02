import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import VatCore

final class APIClientsTests: XCTestCase {
    func testTransceiversDecoding() async throws {
        let feed = try TransceiverStation.decodeFeed(CoreFixtures.data("transceivers.json"))
        XCTAssertEqual(Set(feed.keys), ["LIRF_TWR", "AZA123", "DLH4AB"])
        XCTAssertEqual(feed["LIRF_TWR"]?.count, 2)
        XCTAssertEqual(feed["LIRF_TWR"]?.first?.frequencyMHzString, "118.700")
        XCTAssertEqual(feed["AZA123"]?.count, 2) // entry without frequency skipped
        XCTAssertEqual(feed["AZA123"]?.first?.frequencyMHzString, "132.835")
        XCTAssertEqual(feed["AZA123"]?.last?.frequencyHz, 121_500_000)
        XCTAssertEqual(feed["AZA123"]?.first?.heightMslM ?? 0, 10668, accuracy: 0.1)
        XCTAssertEqual(feed["DLH4AB"], [])

        let http = StubHTTPClient(routes: ["transceivers": .init(body: try CoreFixtures.data("transceivers.json"))])
        let client = TransceiversClient(http: http, cache: .inMemory())
        let fetched = try await client.transceivers()
        XCTAssertEqual(fetched.value["LIRF_TWR"]?.count, 2)
        XCTAssertEqual(Transceiver(id: 0, frequencyHz: 122_800_000, latitude: 0, longitude: 0).frequencyMHzString, "122.800")
    }

    func testBookingsDecodingSkipsBrokenRecords() async throws {
        let bookings = try BookingsClient.decode(CoreFixtures.data("bookings.json"))
        XCTAssertEqual(bookings.map(\.id), [100, 101, 102, 103])
        XCTAssertEqual(bookings[0].callsign, "LIRR_CTR")
        XCTAssertEqual(bookings[0].kind, .event)
        XCTAssertEqual(bookings[2].kind, .exam)
        XCTAssertEqual(bookings[2].cid, 1111111)
        XCTAssertEqual(bookings[3].kind, .booking)
        XCTAssertEqual(FastISO8601.string(from: bookings[1].start), "2026-10-02T18:00:00Z")
        // Wrapped form.
        let wrapped = try BookingsClient.decode(Data(#"{"data": [{"id": 1, "callsign": "EDDF_TWR", "start": "2026-10-02 10:00:00", "end": "2026-10-02 11:00:00"}]}"#.utf8))
        XCTAssertEqual(wrapped.first?.callsign, "EDDF_TWR")

        let http = StubHTTPClient(routes: ["atc-bookings": .init(body: try CoreFixtures.data("bookings.json"))])
        let client = BookingsClient(http: http, cache: .inMemory())
        let fetched = try await client.bookings(date: Date(timeIntervalSince1970: 1_790_932_500), division: "EUD")
        XCTAssertEqual(fetched.value.count, 4)
        let url = await http.requests.first?.url?.absoluteString
        XCTAssertEqual(url, "https://atc-bookings.vatsim.net/api/booking?date=2026-10-02&division=EUD")
    }

    func testEventsDecodingSortedAndTolerant() throws {
        let events = try EventsClient.decode(CoreFixtures.data("events.json"))
        XCTAssertEqual(events.map(\.id), [17004, 17001, 17002])
        let milano = try XCTUnwrap(events.last)
        XCTAssertEqual(milano.airports, ["LIML", "LIMC"])
        XCTAssertEqual(milano.routes.first?.arrival, "LIRF")
        XCTAssertEqual(milano.organisers.first?.subdivision, "ITA")
        XCTAssertEqual(milano.plainDescription, "Join us\nfor night ops & more")
        XCTAssertNotNil(milano.bannerURL)
        XCTAssertEqual(events[1].airports, ["LIRF"])
        XCTAssertEqual(events[0].airports, ["EGLL"])
        XCTAssertEqual(events[0].end.timeIntervalSince(events[0].start), 3 * 3600)
    }

    func testMemberStatsInfoAndFlightPlans() async throws {
        let stats = try CoreFixtures.data("member-stats.json")
        let plans = try CoreFixtures.data("member-flightplans.json")
        let member = try CoreFixtures.data("member.json")
        let http = StubHTTPClient { request in
            let url = request.url?.absoluteString ?? ""
            if url.contains("/999") { return .init(status: 404) }
            if url.hasSuffix("/stats") { return .init(body: stats) }
            if url.hasSuffix("/flightplans") { return .init(body: plans) }
            return .init(body: member)
        }
        let client = MemberClient(http: http, cache: .inMemory())
        let statsValue = try await client.stats(cid: 1234567).value
        XCTAssertEqual(statsValue.cid, 1234567)
        XCTAssertEqual(statsValue.atc, 812.4, accuracy: 1e-9)
        XCTAssertEqual(statsValue.pilot, 1523.25, accuracy: 1e-9)
        XCTAssertEqual(statsValue.s2, 300)
        XCTAssertEqual(statsValue.sup, 0)
        XCTAssertEqual(statsValue.atcHoursByRating.map(\.rating), ["S1", "S2", "S3"])
        XCTAssertEqual(statsValue.totalHours, 2335.65, accuracy: 1e-6)

        let info = try await client.member(cid: 1234567).value
        XCTAssertEqual(info.rating, 4)
        XCTAssertEqual(info.ratingShortName, "S3")
        XCTAssertEqual(info.pilotRating, 3)
        XCTAssertEqual(info.divisionID, "EUD")
        XCTAssertEqual(info.subdivisionID, "ITA")
        XCTAssertEqual(info.registeredAt.map(FastISO8601.string(from:)), "2015-03-14T10:22:31Z")

        let history = try await client.flightPlans(cid: 1234567).value
        XCTAssertEqual(history.map(\.callsign), ["AZA124", "AZA123"])
        XCTAssertEqual(history[1].departure, "LIRF")
        XCTAssertEqual(history[1].arrival, "KJFK")
        XCTAssertEqual(history[1].aircraftType, "B744")
        XCTAssertEqual(history[0].aircraftType, "B744")
        XCTAssertEqual(history[0].departure, "KJFK")
        // Bare array form.
        let bare = try MemberFlightPlan.decodeList(Data(#"[{"callsign": "X1", "dep": "EDDF", "arr": "EGLL"}]"#.utf8))
        XCTAssertEqual(bare.first?.arrival, "EGLL")

        do {
            _ = try await client.stats(cid: 999)
            XCTFail("Expected 404")
        } catch let error as NetworkError {
            XCTAssertEqual(error, .http(status: 404))
        }
    }

    func testSimBriefOFP() async throws {
        let ofp = try SimBriefOFP.decode(CoreFixtures.data("simbrief.json"))
        XCTAssertEqual(ofp.ofpID, "143829104")
        XCTAssertEqual(ofp.airac, "2610")
        XCTAssertEqual(ofp.callsign, "AZA202")
        XCTAssertEqual(ofp.aircraftType, "A21N")
        XCTAssertEqual(ofp.aircraftRegistration, "EI-XYZ")
        XCTAssertEqual(ofp.origin?.icao, "LIRF")
        XCTAssertEqual(ofp.origin?.name, "ROME FIUMICINO")
        XCTAssertEqual(ofp.origin?.runway, "25")
        XCTAssertEqual(ofp.origin?.latitude ?? 0, 41.800278, accuracy: 1e-6)
        XCTAssertEqual(ofp.destination?.icao, "EGLL")
        XCTAssertEqual(ofp.destination?.runway, "27L")
        XCTAssertEqual(ofp.alternate?.icao, "EGKK") // array form → first
        XCTAssertEqual(ofp.route, "RAVAL UM728 ELB UL50 BADEP UN852 RIGNA")
        XCTAssertEqual(ofp.initialAltitudeFt, 36000)
        XCTAssertEqual(ofp.cruiseTAS, 452)
        XCTAssertEqual(ofp.scheduledOut?.timeIntervalSince1970, 1_790_964_000)
        XCTAssertEqual(ofp.scheduledOff?.timeIntervalSince1970, 1_790_964_900)
        XCTAssertEqual(ofp.scheduledOn?.timeIntervalSince1970, 1_790_971_920)
        XCTAssertEqual(ofp.estimatedTimeEnroute, 7020)
        XCTAssertEqual(ofp.navlog.map(\.ident), ["RAVAL", "TOC", "ELB", "BADEP", "EGLL"])
        XCTAssertEqual(ofp.navlog[2].viaAirway, "UM728")
        XCTAssertEqual(ofp.navlog[2].altitudeFt, 36000)
        XCTAssertEqual(ofp.navlog[2].timeTotal, 1560)
        // Waypoints: origin + fixes without TOC and without the destination duplicate + destination.
        XCTAssertEqual(ofp.waypoints.map(\.ident), ["LIRF", "RAVAL", "ELB", "BADEP", "EGLL"])
        XCTAssertEqual(ofp.waypoints[2].kind, .navaid)
        XCTAssertEqual(ofp.waypointLookup.candidates(for: "badep").first?.via, "UL50")

        // Single fix collapsed to an object, single alternate object, empty `{}` values.
        let single = Data(#"""
        {"fetch": {"status": "Success"}, "atc": {"callsign": {}}, "general": {"icao_airline": "DLH", "flight_number": "4AB", "route": "DCT"},
         "origin": {"icao_code": "EDDF", "pos_lat": "50.03", "pos_long": "8.57", "plan_rwy": {}},
         "alternate": {"icao_code": "EDDK", "pos_lat": "50.86", "pos_long": "7.14"},
         "navlog": {"fix": {"ident": "TABUM", "type": "wpt", "pos_lat": "50.5", "pos_long": "8.0", "via_airway": "DCT"}},
         "aircraft": {"icao_code": "A320"}, "times": {"sched_out": {}}}
        """#.utf8)
        let ofp2 = try SimBriefOFP.decode(single)
        XCTAssertEqual(ofp2.navlog.map(\.ident), ["TABUM"])
        XCTAssertEqual(ofp2.alternate?.icao, "EDDK")
        XCTAssertEqual(ofp2.callsign, "DLH4AB")
        XCTAssertEqual(ofp2.origin?.runway, "")
        XCTAssertEqual(ofp2.aircraftType, "A320")
        XCTAssertNil(ofp2.scheduledOut)
        XCTAssertNil(ofp2.destination)
    }

    func testSimBriefErrors() async throws {
        let http = StubHTTPClient(routes: [
            "username=nobody": .text(#"{"fetch": {"status": "Error: Unknown UserID"}}"#, status: 400),
            "username=good": .init(body: try CoreFixtures.data("simbrief.json")),
            "username=weird": .text(#"{"fetch": {"status": "Error: No flight plan on file"}}"#),
        ])
        let client = SimBriefClient(http: http, cache: .inMemory())
        do {
            _ = try await client.latestOFP(username: "nobody")
            XCTFail("Expected userNotFound")
        } catch let error as SimBriefError {
            XCTAssertEqual(error, .userNotFound)
        }
        do {
            _ = try await client.latestOFP(username: "weird")
            XCTFail("Expected server error")
        } catch let error as SimBriefError {
            XCTAssertEqual(error, .server("Error: No flight plan on file"))
        }
        let good = try await client.latestOFP(username: "good")
        XCTAssertEqual(good.value.callsign, "AZA202")
        XCTAssertEqual(good.source, .network)
        // Offline afterwards: last OFP served stale.
        await http.setHandler { _ in throw NetworkError.offline }
        let stale = try await client.latestOFP(username: "good")
        XCTAssertTrue(stale.isStale)
    }

    func testMetarClientBatchesAndCaches() async throws {
        let clock = CoreTestClock()
        let http = StubHTTPClient { request in
            let path = request.url?.lastPathComponent ?? ""
            var lines: [String] = []
            if path.contains("LIRF") { lines.append("LIRF 021350Z 25012KT CAVOK 24/14 Q1015 NOSIG") }
            if path.contains("LIML") { lines.append("METAR LIML 021350Z VRB03KT 9999 FEW040 22/12 Q1016") }
            return .text(lines.joined(separator: "\n") + "\n")
        }
        let client = MetarClient(http: http, cache: .inMemory(), now: clock.closure)
        let batch = try await client.metars(for: ["lirf", "LIML", "ZZZZ"])
        XCTAssertEqual(batch.value.count, 2)
        XCTAssertTrue(batch.value["LIML"]?.hasPrefix("METAR LIML") == true)
        var urls = await http.requests.compactMap { $0.url?.absoluteString }
        XCTAssertEqual(urls, ["https://metar.vatsim.net/LIML,LIRF,ZZZZ"])

        clock.advance(60)
        let single = try await client.metar(for: "LIRF")
        XCTAssertEqual(single.source, .cache)
        XCTAssertEqual(single.value, "LIRF 021350Z 25012KT CAVOK 24/14 Q1015 NOSIG")
        let unknown = try await client.metar(for: "ZZZZ")
        XCTAssertNil(unknown.value)
        urls = await http.requests.compactMap { $0.url?.absoluteString }
        XCTAssertEqual(urls.count, 1)

        let decoded = try await client.decodedMetar(for: "LIRF")
        XCTAssertEqual(decoded.value?.isCAVOK, true)

        clock.advance(600)
        await http.setHandler { _ in throw NetworkError.offline }
        let stale = try await client.metar(for: "LIRF")
        XCTAssertTrue(stale.isStale)
        XCTAssertNotNil(stale.value)
    }

    func testMapDataClientFallsBackToBundleAndDownloads() async throws {
        let dir = CoreFixtures.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let bundled = MapDataFiles(vatspyDat: URL(fileURLWithPath: "/bundle/VATSpy.dat"),
                                   firBoundaries: URL(fileURLWithPath: "/bundle/FIR.geojson"),
                                   traconBoundaries: URL(fileURLWithPath: "/bundle/TRACON.geojson"))
        let clock = CoreTestClock()
        let offline = StubHTTPClient { _ in throw NetworkError.offline }
        let client = MapDataClient(http: offline, directory: dir, bundled: bundled, now: clock.closure)
        let files = await client.refreshIfNeeded()
        XCTAssertEqual(files, bundled)

        let dat = try CoreFixtures.data("vatspy-sample.dat")
        let fir = try CoreFixtures.data("fir-boundaries-sample.geojson")
        let tracon = try CoreFixtures.data("tracon-sample.geojson")
        let online = StubHTTPClient(routes: [
            "api/map_data": .text(#"{"data": {"vatspy_dat_url": "https://example.com/VATSpy.dat", "fir_boundaries_geojson_url": "https://example.com/Boundaries.geojson", "current_commit_hash": "abc123"}}"#),
            "example.com/VATSpy.dat": .init(body: dat),
            "example.com/Boundaries.geojson": .init(body: fir),
            "TRACONBoundaries.geojson": .init(body: tracon),
        ])
        let client2 = MapDataClient(http: online, directory: dir, bundled: bundled, now: clock.closure)
        // Checked less than a day ago by the first client → no download.
        let unchanged = await client2.refreshIfNeeded()
        XCTAssertTrue(unchanged.vatspyIsBundled)
        let count = await online.requests.count
        XCTAssertEqual(count, 0)
        let updated = await client2.refreshIfNeeded(force: true)
        XCTAssertFalse(updated.vatspyIsBundled)
        XCTAssertFalse(updated.firIsBundled)
        XCTAssertFalse(updated.traconIsBundled)
        XCTAssertEqual(updated.commitHash, "abc123")
        XCTAssertEqual(try Data(contentsOf: updated.vatspyDat), dat)
        let database = try SectorDatabase.load(files: updated)
        XCTAssertNotNil(database.volume(id: "FIR:LIRR"))
    }
}
