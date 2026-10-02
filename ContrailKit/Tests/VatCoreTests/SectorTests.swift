import Foundation
import XCTest
@testable import VatCore

final class SectorDatabaseTests: XCTestCase {
    static func makeDatabase() throws -> SectorDatabase {
        let vatspy = VATSpyParser.parse(try CoreFixtures.text("vatspy-sample.dat"))
        return SectorDatabase(
            vatspy: vatspy,
            firBoundaries: try BoundaryParser.parseFIRs(CoreFixtures.data("fir-boundaries-sample.geojson")),
            traconBoundaries: try BoundaryParser.parseTRACONs(CoreFixtures.data("tracon-sample.geojson")),
            airports: AirportDatabase(vatspy: vatspy))
    }

    private func ids(_ db: SectorDatabase, _ callsign: String) -> [String] {
        db.volumes(forCallsign: callsign).map(\.id)
    }

    func testCatalogue() throws {
        let db = try Self.makeDatabase()
        let lirr = try XCTUnwrap(db.volume(id: "FIR:LIRR"))
        XCTAssertEqual(lirr.kind, .fir)
        XCTAssertEqual(lirr.name, "Roma Radar") // FIR name + country suffix
        XCTAssertEqual(lirr.callsignPrefixes, ["LIRR"])
        XCTAssertEqual(lirr.center, GeoPoint(latitude: 41.0, longitude: 12.5))
        XCTAssertEqual(db.volume(id: "FIR:EDGG-N")?.callsignPrefixes, ["EDGG_N", "EDGG_NH"])
        XCTAssertEqual(db.volume(id: "FIR:EDGG-N")?.name, "Langen Radar (North) - Langen")
        XCTAssertEqual(db.volume(id: "FIR:KZNY")?.isOceanic, false)
        XCTAssertEqual(db.volume(id: "FIR:KZNY:OCEANIC")?.isOceanic, true)
        XCTAssertEqual(db.volume(id: "FIR:NZZO")?.isOceanic, true)
        XCTAssertNotNil(db.volume(id: "TRACON:A80/ATL"))
        XCTAssertNotNil(db.volume(id: "TRACON:A80/AHN"))
        XCTAssertNotNil(db.volume(id: "TRACON:PN1"))
        XCTAssertEqual(db.volumes.filter { $0.kind == .uir }.map(\.id).sorted(), ["UIR:EURM", "UIR:LIUP"])
    }

    func testCenterRules() throws {
        let db = try Self.makeDatabase()
        XCTAssertEqual(ids(db, "LIRR_CTR"), ["FIR:LIRR"])
        XCTAssertEqual(ids(db, "LIRR_NE_CTR"), ["FIR:LIRR-NE"])
        XCTAssertEqual(ids(db, "EDGG_NH_CTR"), ["FIR:EDGG-N"])
        XCTAssertEqual(ids(db, "EDGG_E_CTR"), ["FIR:EDGG"]) // unknown middle part → drop it
        XCTAssertEqual(ids(db, "LON_S_CTR"), ["FIR:EGTT"])
        XCTAssertEqual(ids(db, "LON_CTR"), ["FIR:EGTT"])
        XCTAssertEqual(ids(db, "EGTT_CTR"), ["FIR:EGTT"])   // ICAO fallback when the prefix differs
        XCTAssertEqual(ids(db, "NY_CTR"), ["FIR:KZNY"])
        XCTAssertEqual(ids(db, "NY_FSS"), ["FIR:KZNY:OCEANIC"])
        XCTAssertEqual(ids(db, "ATL_CTR"), ["FIR:KZTL"])
        let uir = db.volumes(forCallsign: "EURM_CTR")
        XCTAssertEqual(uir.map(\.id), ["UIR:EURM"])
        XCTAssertEqual(uir.first?.kind, .uir)
        XCTAssertEqual(uir.first?.geometry?.polygons.count, 2) // EDGG + LIMM
        XCTAssertTrue(uir.first?.contains(GeoPoint(latitude: 45, longitude: 9)) ?? false)
        XCTAssertEqual(ids(db, "LIUP_FSS"), ["UIR:LIUP"])
        XCTAssertEqual(ids(db, "ZZZZ_CTR"), [])
        // Facility used when the suffix is not a position.
        let controller = Controller(cid: 1, callsign: "LIRR_1", frequency: "125.500", facility: .center)
        XCTAssertEqual(db.volumes(for: controller).map(\.id), ["FIR:LIRR"])
    }

    func testApproachRules() throws {
        let db = try Self.makeDatabase()
        XCTAssertEqual(ids(db, "ATL_APP"), ["TRACON:A80/ATL"])
        XCTAssertEqual(db.volumes(forCallsign: "ATL_APP").first?.name, "Atlanta Approach")
        XCTAssertEqual(ids(db, "ATL_DEP"), ["TRACON:A80/ATL"])
        XCTAssertEqual(ids(db, "JFK_APP"), ["TRACON:N90/JFK"])
        XCTAssertEqual(ids(db, "NY_APP"), ["TRACON:N90/NY"])
        XCTAssertEqual(ids(db, "LAX_DEP"), ["TRACON:SCT/LAX_DEP"]) // exact suffix preferred
        XCTAssertEqual(ids(db, "LAX_APP"), ["TRACON:SCT/LAX"])     // DEP-only boundary excluded
        XCTAssertEqual(ids(db, "LIRR_PN_DEP"), ["TRACON:PN1"])
        XCTAssertEqual(ids(db, "EDMM_W_APP"), ["TRACON:SWA"])
        XCTAssertEqual(ids(db, "EDMM_APP"), [])                    // needs W_APP; no EDMM airport
        // No TRACON: 40 NM circle around the airport (ICAO, IATA/LID or VATSpy alias).
        let lirf = try XCTUnwrap(db.volumes(forCallsign: "LIRF_APP").first)
        XCTAssertEqual(lirf.id, "APT:LIRF:APP")
        XCTAssertEqual(lirf.kind, .tracon)
        XCTAssertEqual(lirf.radiusNM, 40)
        XCTAssertNil(lirf.geometry)
        XCTAssertEqual(lirf.center, GeoPoint(latitude: 41.811786, longitude: 12.252253))
        XCTAssertEqual(ids(db, "LIRF_N_APP"), ["APT:LIRF:APP"])
        XCTAssertEqual(ids(db, "LIRR_PN_APP"), ["APT:LIRF:APP"]) // VATSpy alias LIRR → LIRF
        XCTAssertEqual(ids(db, "SOLENT_APP"), ["APT:EGHI:APP"])
        XCTAssertEqual(ids(db, "LIMM_APP"), ["APT:LIMM:APP"]) // pseudo airport
    }

    func testAirportLocalRules() throws {
        let db = try Self.makeDatabase()
        let tower = try XCTUnwrap(db.volumes(forCallsign: "LIRF_TWR").first)
        XCTAssertEqual(tower.id, "APT:LIRF:TWR")
        XCTAssertEqual(tower.kind, .airport)
        XCTAssertEqual(tower.radiusNM, 12)
        XCTAssertEqual(tower.name, "Roma-Fiumicino Tower")
        XCTAssertEqual(db.volumes(forCallsign: "LIRF_GND").first?.radiusNM, 6)
        XCTAssertEqual(db.volumes(forCallsign: "LIRF_RMP").first?.radiusNM, 6)
        XCTAssertEqual(db.volumes(forCallsign: "LIRF_DEL").first?.radiusNM, 3)
        XCTAssertEqual(db.volumes(forCallsign: "LIRF_ATIS").first?.radiusNM, 0)
        XCTAssertEqual(ids(db, "JFK_TWR"), ["APT:KJFK:TWR"])
        XCTAssertEqual(ids(db, "KJFK_TWR"), ["APT:KJFK:TWR"])
        XCTAssertEqual(ids(db, "UACC_TWR"), ["TRACON:UACC"]) // SimAware tower polygon
        XCTAssertEqual(ids(db, "LIRF_OBS"), [])
        XCTAssertEqual(ids(db, "XXXX_TWR"), [])
        XCTAssertEqual(db.airport(forCallsign: "JFK_GND")?.icao, "KJFK")
        XCTAssertTrue(tower.contains(GeoPoint(latitude: 41.9, longitude: 12.3)))
    }

    func testPointQueries() throws {
        let db = try Self.makeDatabase()
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: 41, longitude: 12))?.id, "LIRR")
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: 42.5, longitude: 13))?.id, "LIRR") // parent over sub-sector
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: -25, longitude: 179.5))?.id, "NZZO")
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: -25, longitude: -175))?.id, "NZZO")
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: 31, longitude: -58))?.isOceanic, true)
        XCTAssertNil(db.firContaining(GeoPoint(latitude: 0, longitude: 0)))

        let here = db.volumesContaining(GeoPoint(latitude: 42.5, longitude: 13)).map(\.id)
        XCTAssertEqual(here.first, "FIR:LIRR-NE")
        XCTAssertTrue(here.contains("FIR:LIRR"))
        XCTAssertTrue(here.contains("UIR:LIUP"))
        XCTAssertEqual(db.volumesContaining(GeoPoint(latitude: 33.6, longitude: -84.4)).first?.id, "TRACON:A80/ATL")
        let visible = db.volumes(intersecting: GeoBounds(minLat: 40, maxLat: 44, minLon: 10, maxLon: 14)).map(\.id)
        XCTAssertTrue(visible.contains("FIR:LIRR"))
        XCTAssertTrue(visible.contains("TRACON:PN1"))
        XCTAssertFalse(visible.contains("FIR:EGTT"))
    }
}

final class ActiveSectorsBuilderTests: XCTestCase {
    func testStatesAndAirportStatus() throws {
        let db = try SectorDatabaseTests.makeDatabase()
        let now = try XCTUnwrap(FastISO8601.parse("2026-10-02T18:00:00Z"))
        let controllers = [
            Controller(cid: 1, callsign: "LIRR_CTR", frequency: "125.500", facility: .center),
            Controller(cid: 2, callsign: "LIRF_TWR", frequency: "118.700", facility: .tower),
            Controller(cid: 3, callsign: "LIRF_GND", frequency: "199.998", facility: .ground), // not on frequency
            Controller(cid: 4, callsign: "LIRF_OBS", frequency: "199.998", facility: .observer),
            Controller(cid: 5, callsign: "ATL_APP", frequency: "121.000", facility: .approach),
        ]
        let atis = [Controller(cid: 6, callsign: "LIRF_ATIS", frequency: "121.700", facility: .tower, atisCode: "K")]
        let bookings = [
            ATCBooking(id: 1, callsign: "LIRR_CTR", start: now.addingTimeInterval(-3600), end: now.addingTimeInterval(3600)),
            ATCBooking(id: 2, callsign: "EDGG_CTR", start: now.addingTimeInterval(-600), end: now.addingTimeInterval(3600)),
            ATCBooking(id: 3, callsign: "LIML_TWR", start: now.addingTimeInterval(1800), end: now.addingTimeInterval(7200)),
            ATCBooking(id: 4, callsign: "KJFK_GND", start: now.addingTimeInterval(3 * 3600), end: now.addingTimeInterval(5 * 3600)),
            ATCBooking(id: 5, callsign: "EDDF_TWR", start: now.addingTimeInterval(-7200), end: now.addingTimeInterval(-3600)),
        ]
        let builder = ActiveSectorsBuilder(sectors: db)
        let result = builder.build(controllers: controllers, atis: atis, bookings: bookings, now: now)
        let byID = Dictionary(uniqueKeysWithValues: result.sectors.map { ($0.id, $0) })

        XCTAssertEqual(Set(byID.keys), ["FIR:LIRR", "APT:LIRF:TWR", "APT:LIRF:ATIS", "TRACON:A80/ATL", "FIR:EDGG", "APT:LIML:TWR"])
        XCTAssertEqual(byID["FIR:LIRR"]?.state, .online)
        XCTAssertEqual(byID["FIR:LIRR"]?.booking?.id, 1)
        XCTAssertEqual(byID["FIR:LIRR"]?.controllers.map(\.callsign), ["LIRR_CTR"])
        XCTAssertEqual(byID["APT:LIRF:TWR"]?.atis.map(\.callsign), ["LIRF_ATIS"])
        XCTAssertEqual(byID["APT:LIRF:ATIS"]?.state, .online)
        XCTAssertEqual(byID["FIR:EDGG"]?.state, .booked)
        XCTAssertEqual(byID["FIR:EDGG"]?.controllers, [])
        XCTAssertEqual(byID["APT:LIML:TWR"]?.state, .booked)
        XCTAssertEqual(byID["APT:LIML:TWR"]?.booking?.id, 3)
        // Online first.
        XCTAssertEqual(result.sectors.prefix(4).map(\.state), [.online, .online, .online, .online])
        XCTAssertEqual(result.sectors.first?.id, "FIR:LIRR")

        let lirf = try XCTUnwrap(result.airports["LIRF"])
        XCTAssertEqual(lirf.online, [.tower, .atis])
        XCTAssertEqual(lirf.atisCode, "K")
        XCTAssertEqual(lirf.state, .online)
        XCTAssertEqual(lirf.onlineSorted, [.tower, .atis])
        let liml = try XCTUnwrap(result.airports["LIML"])
        XCTAssertEqual(liml.booked, [.tower])
        XCTAssertEqual(liml.state, .booked)
        XCTAssertEqual(result.airports["KATL"]?.online, [.approach])
        XCTAssertNil(result.airports["KJFK"])
        XCTAssertNil(result.airports["EDDF"])

        // Observers included when frequency is not required, still no volumes for OBS.
        let lenient = ActiveSectorsBuilder(sectors: db, requireFrequency: false)
        let all = lenient.activeSectors(controllers: controllers, atis: [], now: now)
        XCTAssertTrue(all.contains { $0.id == "APT:LIRF:GND" })
    }

    func testBuildFromSnapshot() throws {
        let db = try SectorDatabaseTests.makeDatabase()
        let snapshot = NetworkSnapshot(feed: try VatsimFeed.decode(from: CoreFixtures.data("vatsim-data-sample.json")))
        let result = ActiveSectorsBuilder(sectors: db).build(snapshot: snapshot, now: Date())
        XCTAssertEqual(Set(result.sectors.map(\.id)), ["FIR:LIRR", "APT:LIRF:APP", "APT:LIRF:ATIS"])
        XCTAssertEqual(result.airports["LIRF"]?.online, [.approach, .atis])
        XCTAssertEqual(result.airports["LIRF"]?.state, .online)
    }
}
