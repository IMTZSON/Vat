import Foundation
import XCTest
@testable import VatCore

final class VATSpyParserTests: XCTestCase {
    func testParsesSectionsWithCRLFAndBrokenLines() throws {
        let data = VATSpyParser.parse(try CoreFixtures.text("vatspy-sample.dat"))
        XCTAssertEqual(data.countries.map(\.icaoPrefix), ["ED", "LI", "EG"])
        XCTAssertEqual(data.countries[1].centerSuffixName, "Radar")
        // XBAD (latitude out of range) and XMIS (missing columns) skipped; LIRU kept with missing tail.
        XCTAssertEqual(data.airports.count, 11)
        XCTAssertEqual(data.airports.filter(\.isPseudo).map(\.icao), ["EGHI", "LIMM"])
        let lirf = try XCTUnwrap(data.airports.first { $0.icao == "LIRF" })
        XCTAssertEqual(lirf.name, "Roma-Fiumicino")
        XCTAssertEqual(lirf.iata, "LIRR")
        XCTAssertEqual(lirf.fir, "LIRR")
        XCTAssertEqual(lirf.latitude, 41.811786, accuracy: 1e-9)
        let liru = try XCTUnwrap(data.airports.first { $0.icao == "LIRU" })
        XCTAssertEqual(liru.iata, "")
        XCTAssertFalse(liru.isPseudo)

        XCTAssertEqual(data.firs.count, 9)
        XCTAssertEqual(data.firs[1], FIREntry(icao: "EDGG-N", name: "Langen Radar (North) - Langen", callsignPrefix: "EDGG_N", boundaryID: "EDGG-N"))
        XCTAssertEqual(data.firs[0].effectivePrefix, "EDGG")
        XCTAssertEqual(data.firs.first { $0.icao == "EGTT" }?.effectivePrefix, "LON")
        XCTAssertEqual(data.uirs.map(\.id), ["LIUP", "EURM"])
        XCTAssertEqual(data.uirs[0].firIDs, ["LIMM", "LIBB", "LIRR", "LIPP"])
        XCTAssertEqual(data.idl.count, 3)
        XCTAssertEqual(data.country(forICAO: "LIRR")?.name, "Italy")
        XCTAssertNil(data.country(forICAO: "KZNY"))
    }

    func testEmptyAndGarbageInput() {
        XCTAssertTrue(VATSpyParser.parse("").airports.isEmpty)
        let data = VATSpyParser.parse("garbage\n[Airports]\n|||\nAAAA|x|1|2\n[Unknown]\nfoo|bar\n")
        XCTAssertEqual(data.airports.map(\.icao), ["AAAA"])
    }
}

final class BoundaryParserTests: XCTestCase {
    func testFIRBoundaries() throws {
        let firs = try BoundaryParser.parseFIRs(CoreFixtures.data("fir-boundaries-sample.geojson"))
        XCTAssertEqual(firs.count, 10) // no-geometry, LineString and garbage skipped
        let lirr = try XCTUnwrap(firs.first { $0.id == "LIRR" })
        XCTAssertFalse(lirr.isOceanic)
        XCTAssertEqual(lirr.labelPoint, GeoPoint(latitude: 41.0, longitude: 12.5))
        XCTAssertEqual(lirr.region, "EMEA")
        XCTAssertEqual(lirr.division, "VATITA")
        XCTAssertTrue(lirr.geometry.contains(GeoPoint(latitude: 41.8, longitude: 12.25)))
        let ne = try XCTUnwrap(firs.first { $0.id == "LIRR-NE" }) // Polygon geometry
        XCTAssertEqual(ne.geometry.polygons.count, 1)
        XCTAssertEqual(ne.labelPoint.latitude, 42.5, accuracy: 0.01)
        XCTAssertEqual(firs.filter { $0.id == "KZNY" }.map(\.isOceanic), [false, true])
        let nzzo = try XCTUnwrap(firs.first { $0.id == "NZZO" })
        XCTAssertTrue(nzzo.geometry.contains(GeoPoint(latitude: -25, longitude: -175)))
        XCTAssertTrue(nzzo.geometry.contains(GeoPoint(latitude: -25, longitude: 179)))
    }

    func testTRACONBoundaries() throws {
        let tracons = try BoundaryParser.parseTRACONs(CoreFixtures.data("tracon-sample.geojson"))
        XCTAssertEqual(tracons.count, 9)
        XCTAssertEqual(tracons[0].id, "A80")
        XCTAssertEqual(tracons[0].prefixes, ["ATL"])
        XCTAssertNil(tracons[0].suffix)
        XCTAssertEqual(tracons[2].labelPoint, GeoPoint(latitude: 40.47, longitude: -73.77))
        XCTAssertEqual(tracons[3].prefixes, ["NY"]) // string form
        XCTAssertEqual(tracons[5].suffix, "DEP")
        XCTAssertEqual(tracons[7].suffix, "W_APP")
        XCTAssertThrowsError(try BoundaryParser.parseFIRs(Data("[]".utf8)))
    }
}

final class AirportDatabaseTests: XCTestCase {
    private func makeDatabase() throws -> AirportDatabase {
        let vatspy = VATSpyParser.parse(try CoreFixtures.text("vatspy-sample.dat"))
        let extras = """
        LIRF,13,IT,Rome,1,large_airport
        LIRA,427,IT,"Roma, Ciampino",1,medium_airport
        LIRU,55,IT,Rome,0,small_airport
        KJFK,13,US,New York,1,large_airport
        bad line
        """
        return AirportDatabase(vatspy: vatspy, extrasCSV: extras)
    }

    func testLookups() throws {
        let db = try makeDatabase()
        XCTAssertEqual(db.count, 9) // pseudo entries excluded, duplicate EGHI collapsed
        XCTAssertEqual(db.airport(icao: "lirf")?.elevationFt, 13)
        XCTAssertEqual(db.airport(icao: "LIRA")?.city, "Roma, Ciampino")
        XCTAssertEqual(db.airport(icao: "LIRF")?.hasScheduledService, true)
        XCTAssertEqual(db.airport(icao: "LIRF")?.country, "IT")
        XCTAssertEqual(db.airport(icao: "EGHI")?.name, "Southampton") // real airport wins over pseudo
        XCTAssertEqual(db.airport(icao: "LIMM")?.isPseudo, true)        // pseudo-only fallback
        XCTAssertEqual(db.airport(iataOrLID: "JFK")?.icao, "KJFK")
        XCTAssertEqual(db.airport(iataOrLID: "atl")?.icao, "KATL")
        XCTAssertEqual(db.airport(iataOrLID: "SOLENT")?.icao, "EGHI")
        XCTAssertEqual(db.airport(callsignPrefix: "LHR")?.icao, "EGLL")
        XCTAssertNil(db.airport(icao: "XXXX"))
        XCTAssertEqual(db.candidates(for: "LIRF").first?.kind, .airport)
        XCTAssertTrue(db.candidates(for: "NOPE").isEmpty)
    }

    func testSearchAndNearest() throws {
        let db = try makeDatabase()
        XCTAssertEqual(db.search("LIR").map(\.icao), ["LIRF", "LIRA", "LIRU"]) // larger airports first
        XCTAssertEqual(db.search("jfk").first?.icao, "KJFK")
        XCTAssertEqual(db.search("FIUMICINO").first?.icao, "LIRF")
        XCTAssertEqual(db.search("ciampino").first?.icao, "LIRA")
        XCTAssertEqual(db.search("Roma", limit: 2).count, 2)
        XCTAssertEqual(db.search("heathrow").first?.icao, "EGLL")
        XCTAssertTrue(db.search("").isEmpty)

        let nearFCO = GeoPoint(latitude: 41.80, longitude: 12.30)
        XCTAssertEqual(db.nearest(to: nearFCO)?.icao, "LIRF")
        XCTAssertEqual(db.airports(near: nearFCO, withinNM: 30).map(\.icao), ["LIRF", "LIRU", "LIRA"])
        XCTAssertNil(db.nearest(to: GeoPoint(latitude: 0, longitude: 0)))
        let italy = db.airports(in: GeoBounds(minLat: 41, maxLat: 46, minLon: 9, maxLon: 13))
        XCTAssertEqual(Set(italy.map(\.icao)), ["LIRF", "LIRA", "LIRU", "LIML"])
    }

    func testDiacriticInsensitiveSearch() {
        let db = AirportDatabase(airports: [
            Airport(icao: "LEMD", name: "Madrid-Barajas", latitude: 40.47, longitude: -3.56),
            Airport(icao: "ENZV", name: "Stavanger Sola", latitude: 58.88, longitude: 5.64),
            Airport(icao: "LOWW", name: "Wien-Schwechat", latitude: 48.11, longitude: 16.57, city: "Wien"),
            Airport(icao: "LFPG", name: "Paris Charles de Gaulle", latitude: 49.01, longitude: 2.55),
            Airport(icao: "EKCH", name: "København Kastrup", latitude: 55.62, longitude: 12.65),
            Airport(icao: "LSZH", name: "Zürich", latitude: 47.46, longitude: 8.55),
        ])
        XCTAssertEqual(db.search("zurich").first?.icao, "LSZH")
        XCTAssertEqual(db.search("ZÜRICH").first?.icao, "LSZH")
        XCTAssertEqual(db.search("københavn").first?.icao, "EKCH")
        XCTAssertEqual(db.search("barajas").first?.icao, "LEMD")
        XCTAssertEqual(db.search("wien").first?.icao, "LOWW")
    }

    func testNavaidDatabase() throws {
        let csv = """
        ELB,Elba,VOR-DME,42.7256,10.3958,114700,IT
        OST,"Ostia, Roma",VOR-DME,41.8,12.24,114150,IT
        OST,Ostrava,NDB,49.7,18.1,350,CZ
        BAD,line
        """
        let db = NavaidDatabase(csv: csv)
        XCTAssertEqual(db.count, 3)
        XCTAssertEqual(db.navaids(ident: "ost").count, 2)
        XCTAssertEqual(db.navaids(ident: "OST").first?.name, "Ostia, Roma")
        XCTAssertEqual(db.navaid(ident: "OST", near: GeoPoint(latitude: 50, longitude: 18))?.country, "CZ")
        XCTAssertEqual(db.navaids(ident: "ELB").first?.frequencyKHz, 114700)
        XCTAssertEqual(db.candidates(for: "ELB").first?.kind, .navaid)

        let airports = AirportDatabase(airports: [Airport(icao: "LIRF", name: "Fiumicino", latitude: 41.8, longitude: 12.25)])
        let combined = CombinedWaypointLookup([airports, db, StaticWaypointLookup(waypoints: [
            Waypoint(ident: "RAVAL", kind: .fix, point: GeoPoint(latitude: 42.1, longitude: 11.8)),
        ])])
        XCTAssertEqual(combined.candidates(for: "LIRF").count, 1)
        XCTAssertEqual(combined.candidates(for: "OST").count, 2)
        XCTAssertEqual(combined.candidates(for: "RAVAL").first?.kind, .fix)
        XCTAssertTrue(combined.candidates(for: "NOPE").isEmpty)
    }
}
