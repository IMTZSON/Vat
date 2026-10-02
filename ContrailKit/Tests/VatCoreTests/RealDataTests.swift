import Foundation
import XCTest
@testable import VatCore

/// Loads the real bundled data from `App/Resources/Data` (skipped when not available, e.g. when only
/// the package is mounted). Set `CONTRAIL_DATA_DIR` to point elsewhere.
final class RealDataTests: XCTestCase {
    static var dataDirectory: URL? {
        if let env = ProcessInfo.processInfo.environment["CONTRAIL_DATA_DIR"], !env.isEmpty {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        // <repo>/ContrailKit/Tests/VatCoreTests/RealDataTests.swift → <repo>/App/Resources/Data
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("App/Resources/Data", isDirectory: true)
    }

    private func file(_ name: String) throws -> URL {
        guard let dir = Self.dataDirectory else { throw XCTSkip("No data directory") }
        let url = dir.appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: url.path) else { throw XCTSkip("Bundled data not found at \(url.path)") }
        return url
    }

    private func measure<T>(_ label: String, _ body: () throws -> T) rethrows -> T {
        let start = Date()
        let value = try body()
        print(String(format: "[RealData] %@: %.3f s", label, Date().timeIntervalSince(start)))
        return value
    }

    func testBundledDataBuildsAndResolvesKnownCallsigns() throws {
        let datURL = try file("VATSpy.dat")
        let firURL = try file("FIRBoundaries.geojson")
        let traconURL = try file("TRACONBoundaries.geojson")
        let extrasURL = try file("airport_extras.csv")
        let navaidsURL = try file("navaids.csv")

        let total = Date()
        let vatspy = try measure("VATSpy.dat parse") { try VATSpyParser.parse(contentsOf: datURL) }
        let firs = try measure("FIR boundaries parse") { try BoundaryParser.parseFIRs(contentsOf: firURL) }
        let tracons = try measure("TRACON boundaries parse") { try BoundaryParser.parseTRACONs(contentsOf: traconURL) }
        let extras = try String(contentsOf: extrasURL, encoding: .utf8)
        let airports = measure("AirportDatabase build") { AirportDatabase(airports: vatspy.airports, extrasCSV: extras) }
        let db = measure("SectorDatabase build") {
            SectorDatabase(vatspy: vatspy, firBoundaries: firs, traconBoundaries: tracons, airports: airports)
        }
        let elapsed = Date().timeIntervalSince(total)
        print(String(format: "[RealData] total database build: %.3f s", elapsed))

        XCTAssertGreaterThan(vatspy.countries.count, 200)
        XCTAssertGreaterThan(vatspy.airports.count, 15_000)
        XCTAssertGreaterThan(vatspy.firs.count, 1_000)
        XCTAssertGreaterThan(vatspy.uirs.count, 30)
        XCTAssertGreaterThan(vatspy.idl.count, 5)
        XCTAssertGreaterThan(firs.count, 1_000)
        XCTAssertGreaterThan(tracons.count, 1_000)
        XCTAssertGreaterThan(airports.count, 15_000)
        XCTAssertGreaterThan(db.volumes.count, 2_000)

        // Airports.
        let lirf = try XCTUnwrap(airports.airport(icao: "LIRF"))
        XCTAssertEqual(lirf.city, "Rome")
        XCTAssertEqual(lirf.country, "IT")
        XCTAssertEqual(airports.airport(iataOrLID: "JFK")?.icao, "KJFK")
        XCTAssertEqual(airports.airport(iataOrLID: "ATL")?.icao, "KATL")
        XCTAssertEqual(airports.search("fiumicino").first?.icao, "LIRF")
        XCTAssertEqual(airports.search("LIRF").first?.icao, "LIRF")
        XCTAssertEqual(airports.nearest(to: GeoPoint(latitude: 41.80, longitude: 12.24))?.icao, "LIRF")

        // FIR / sub-sector / UIR rules.
        XCTAssertEqual(db.volumes(forCallsign: "LIRR_CTR").map(\.id), ["FIR:LIRR"])
        XCTAssertEqual(db.volumes(forCallsign: "EDGG_E_CTR").map(\.id), ["FIR:EDGG"])
        XCTAssertEqual(db.volumes(forCallsign: "EDGG_N_CTR").map(\.id), ["FIR:EDGG-N"])
        XCTAssertEqual(db.volumes(forCallsign: "LON_S_CTR").map(\.id), ["FIR:EGTT-S"])
        XCTAssertEqual(db.volumes(forCallsign: "NY_CTR").first?.isOceanic, false)
        let euroNorth = db.volumes(forCallsign: "EURN_FSS")
        XCTAssertEqual(euroNorth.map(\.id), ["UIR:EURN"])
        XCTAssertEqual(euroNorth.first?.kind, .uir)

        // TRACON and airport rules.
        XCTAssertTrue(db.volumes(forCallsign: "ATL_APP").first?.id.hasPrefix("TRACON:A80") ?? false)
        XCTAssertTrue(db.volumes(forCallsign: "JFK_APP").first?.id.hasPrefix("TRACON:N90") ?? false)
        XCTAssertEqual(db.volumes(forCallsign: "JFK_TWR").map(\.id), ["APT:KJFK:TWR"])
        XCTAssertEqual(db.volumes(forCallsign: "LIRF_TWR").first?.radiusNM, 12)

        // Spatial queries.
        XCTAssertEqual(db.firContaining(lirf.position)?.id, "LIRR")
        XCTAssertEqual(db.firContaining(GeoPoint(latitude: 50.03, longitude: 8.57))?.id, "EDGG")
        let pointTiming = Date()
        for i in 0..<1_000 {
            _ = db.firContaining(GeoPoint(latitude: Double(i % 140) - 70, longitude: Double(i % 360) - 180))
        }
        print(String(format: "[RealData] 1000 firContaining queries: %.3f s", Date().timeIntervalSince(pointTiming)))

        // Navaids.
        let navaids = try measure("NavaidDatabase build") { NavaidDatabase(csv: try String(contentsOf: navaidsURL, encoding: .utf8)) }
        XCTAssertGreaterThan(navaids.count, 10_000)
        XCTAssertFalse(navaids.navaids(ident: "OST").isEmpty)
    }
}
