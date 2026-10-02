import Foundation
import XCTest
@testable import VatCore

final class FeedDecodingTests: XCTestCase {
    func loadFixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    func testDecodesSampleFeedAndSkipsBrokenRecords() throws {
        let feed = try VatsimFeed.decode(from: loadFixture("vatsim-data-sample.json"))
        XCTAssertEqual(feed.general.version, 3)
        XCTAssertEqual(feed.general.connectedClients, 6)
        XCTAssertNotNil(feed.general.updateTimestamp)
        // 2 valid pilots; no position / invalid latitude / non-object are skipped.
        XCTAssertEqual(feed.pilots.map(\.callsign), ["AZA123", "DLH4AB"])
        XCTAssertEqual(feed.controllers.count, 3)
        XCTAssertEqual(feed.atis.first?.atisCode, "K")
        XCTAssertEqual(feed.prefiles.first?.flightPlan?.arrival, "LIML")
        XCTAssertEqual(feed.pilotRatings.first?.short, "PPL")
    }

    func testPilotFieldsAndDefaults() throws {
        let feed = try VatsimFeed.decode(from: loadFixture("vatsim-data-sample.json"))
        let aza = try XCTUnwrap(feed.pilots.first)
        XCTAssertEqual(aza.cid, 1234567)
        XCTAssertEqual(aza.altitude, 35012)
        XCTAssertEqual(aza.flightPlan?.aircraftType, "A320")
        XCTAssertEqual(aza.flightPlan?.cruiseAltitudeFeet, 36000)
        XCTAssertEqual(aza.flightPlan?.enrouteDuration, 9000)
        let dlh = feed.pilots[1]
        XCTAssertEqual(dlh.cid, 7654321)          // numeric string accepted
        XCTAssertEqual(dlh.latitude, 50.03, accuracy: 1e-9)
        XCTAssertEqual(dlh.altitude, 120)         // double truncated
        XCTAssertEqual(dlh.groundspeed, 0)        // null → 0
        XCTAssertEqual(dlh.heading, 5)            // 725 normalised
        XCTAssertNil(dlh.flightPlan)
        XCTAssertEqual(dlh.transponder, "2000")
    }

    func testControllerPositions() throws {
        let feed = try VatsimFeed.decode(from: loadFixture("vatsim-data-sample.json"))
        let positions = feed.controllers.map(\.position)
        XCTAssertEqual(positions, [.center, .observer, .approach])
        XCTAssertFalse(feed.controllers[1].isOnFrequency)
        XCTAssertTrue(feed.controllers[0].isOnFrequency)
        XCTAssertEqual(feed.controllers[2].callsignParts.middle, ["N"])
        XCTAssertEqual(feed.controllers[1].textAtis, [])
    }

    func testEmptyAndGarbagePayloads() throws {
        XCTAssertEqual(try VatsimFeed.decode(from: Data("{}".utf8)).pilots.count, 0)
        XCTAssertEqual(try VatsimFeed.decode(from: Data(#"{"pilots": 5, "controllers": "x"}"#.utf8)).pilots.count, 0)
        XCTAssertThrowsError(try VatsimFeed.decode(from: Data("not json".utf8)))
    }

    func testFastISO8601() throws {
        let d = try XCTUnwrap(FastISO8601.parse("2026-10-02T09:15:00.1234567Z"))
        XCTAssertEqual(d.timeIntervalSince1970, 1_790_932_500.1234567, accuracy: 1e-6)
        XCTAssertEqual(FastISO8601.parse("2026-10-02 09:15:00")?.timeIntervalSince1970, 1_790_932_500)
        XCTAssertEqual(FastISO8601.parse("2026-10-02T11:15:00+02:00")?.timeIntervalSince1970, 1_790_932_500)
        XCTAssertNil(FastISO8601.parse("garbage"))
        XCTAssertNil(FastISO8601.parse("2026-13-02T09:15:00Z"))
        XCTAssertEqual(FastISO8601.string(from: Date(timeIntervalSince1970: 1_790_932_500)), "2026-10-02T09:15:00Z")
    }

    func testDepartureDateWrapsAroundMidnight() throws {
        let fp = FlightPlan(deptime: "2350")
        let ref = try XCTUnwrap(FastISO8601.parse("2026-10-02T00:10:00Z"))
        XCTAssertEqual(fp.departureDate(relativeTo: ref).map(FastISO8601.string(from:)), "2026-10-01T23:50:00Z")
    }
}
