import Foundation
import XCTest
@testable import VatCore

final class WeatherTests: XCTestCase {
    func testRainViewerManifestAndTileTemplate() async throws {
        let manifest = try JSONDecoder().decode(RadarManifest.self, from: CoreFixtures.data("rainviewer.json"))
        XCTAssertEqual(manifest.host, "https://tilecache.rainviewer.com")
        XCTAssertEqual(manifest.frames.map(\.time), [1_790_958_600, 1_790_959_200, 1_790_959_800])
        let latest = try XCTUnwrap(manifest.latestFrame)
        XCTAssertEqual(manifest.tileURLTemplate(frame: latest),
                       "https://tilecache.rainviewer.com/v2/radar/b2c3d4e5f6a1/256/{z}/{x}/{y}/2/1_1.png")
        XCTAssertEqual(manifest.tileURL(frame: latest, z: 5, x: 17, y: 11)?.absoluteString,
                       "https://tilecache.rainviewer.com/v2/radar/b2c3d4e5f6a1/256/5/17/11/2/1_1.png")
        XCTAssertEqual(RadarManifest.maxZoom, 7)

        let http = StubHTTPClient(routes: ["rainviewer": .init(body: try CoreFixtures.data("rainviewer.json"))])
        let fetched = try await WeatherClient(http: http, cache: .inMemory()).radarManifest()
        XCTAssertEqual(fetched.value.frames.count, 3)
    }

    func testInternationalSigmets() throws {
        let sigmets = try SigmetParser.parse(CoreFixtures.data("isigmet.geojson"))
        XCTAssertEqual(sigmets.count, 4)
        let ts = sigmets[0]
        XCTAssertEqual(ts.hazard, "TS")
        XCTAssertEqual(ts.qualifier, "EMBD")
        XCTAssertEqual(ts.firID, "LIRR")
        XCTAssertEqual(ts.firName, "LIRR ROMA")
        XCTAssertEqual(ts.kind, "ISIGMET")
        XCTAssertEqual(ts.baseFt, 0)
        XCTAssertEqual(ts.topFt, 38000)
        XCTAssertEqual(ts.validFrom.map(FastISO8601.string(from:)), "2026-10-02T12:00:00Z")
        XCTAssertTrue(ts.rawText.hasPrefix("LIRR SIGMET 3"))
        XCTAssertEqual(ts.geometry?.polygons.count, 1)
        XCTAssertTrue(ts.geometry?.contains(GeoPoint(latitude: 42, longitude: 12.5)) ?? false)
        XCTAssertTrue(ts.isValid(at: FastISO8601.parse("2026-10-02T13:00:00Z")!))
        XCTAssertFalse(ts.isValid(at: FastISO8601.parse("2026-10-02T17:00:00Z")!))

        let turb = sigmets[1]
        XCTAssertEqual(turb.geometry?.polygons.count, 2)
        XCTAssertEqual(turb.validFrom?.timeIntervalSince1970, 1_790_942_400)
        XCTAssertEqual(turb.validTo?.timeIntervalSince1970, 1_790_956_800)
        XCTAssertEqual(turb.topFt, 40000)
        XCTAssertNil(turb.baseFt) // "FL300" is not numeric
        XCTAssertNil(sigmets[2].geometry)
        XCTAssertEqual(sigmets[2].hazard, "VA")
        XCTAssertNil(sigmets[3].geometry) // Point geometry ignored
        XCTAssertEqual(Set(sigmets.map(\.id)).count, sigmets.count)
    }

    func testUSAirSigmetsAndCombinedClient() async throws {
        let us = try SigmetParser.parse(CoreFixtures.data("airsigmet.geojson"))
        XCTAssertEqual(us.map(\.kind), ["SIGMET", "AIRMET"])
        XCTAssertEqual(us[0].hazard, "CONVECTIVE")
        XCTAssertEqual(us[0].topFt, 45000)
        XCTAssertEqual(us[1].topFt, 12000)
        XCTAssertTrue(us[0].rawText.hasPrefix("CONVECTIVE SIGMET"))

        let http = StubHTTPClient(routes: [
            "isigmet": .init(body: try CoreFixtures.data("isigmet.geojson")),
            "airsigmet": .init(body: try CoreFixtures.data("airsigmet.geojson")),
        ])
        let client = WeatherClient(http: http, cache: .inMemory())
        let all = try await client.sigmets()
        XCTAssertEqual(all.value.count, 6)
        XCTAssertFalse(all.isStale)

        let partial = StubHTTPClient(routes: ["isigmet": .init(body: try CoreFixtures.data("isigmet.geojson"))])
        let half = try await WeatherClient(http: partial, cache: .inMemory()).sigmets()
        XCTAssertEqual(half.value.count, 4)
        XCTAssertTrue(half.isStale)
    }

    func testFDWindsAloft() throws {
        let stations = WindsAloftParser.parse(try CoreFixtures.text("windtemp.txt")) { id in
            id == "BOS" ? GeoPoint(latitude: 42.36, longitude: -71.0) : nil
        }
        XCTAssertEqual(stations.map(\.id), ["BOS", "DEN", "ABQ", "JFK"])

        let bos = stations[0]
        XCTAssertNotNil(bos.position)
        XCTAssertEqual(bos.levels.count, 9)
        XCTAssertEqual(bos.levels[0], WindLevel(altitudeFt: 3000, directionDeg: 310, speedKt: 15))
        XCTAssertEqual(bos.levels[1], WindLevel(altitudeFt: 6000, directionDeg: 300, speedKt: 13, temperatureC: -3))
        XCTAssertEqual(bos.level(nearest: 34000), WindLevel(altitudeFt: 34000, directionDeg: 250, speedKt: 50, temperatureC: -55))
        XCTAssertEqual(bos.levels[6], WindLevel(altitudeFt: 30000, directionDeg: 250, speedKt: 41, temperatureC: -49))

        // DEN: 3000/6000 missing (station elevation), 7xx encoding above 100 kt.
        let den = stations[1]
        XCTAssertEqual(den.levels.first?.altitudeFt, 9000)
        XCTAssertEqual(den.levels.first?.temperatureC, 5)
        XCTAssertEqual(den.level(nearest: 30000), WindLevel(altitudeFt: 30000, directionDeg: 260, speedKt: 116, temperatureC: -45))
        XCTAssertEqual(den.level(nearest: 34000), WindLevel(altitudeFt: 34000, directionDeg: 280, speedKt: 119, temperatureC: -54))

        // ABQ: light and variable at 6000 and 9000 (with temperature).
        let abq = stations[2]
        XCTAssertEqual(abq.levels.first?.altitudeFt, 6000)
        XCTAssertEqual(abq.levels.first?.isLightAndVariable, true)
        XCTAssertEqual(abq.levels[1], WindLevel(altitudeFt: 9000, directionDeg: 0, speedKt: 0, temperatureC: 10, isLightAndVariable: true))

        let jfk = stations[3]
        XCTAssertEqual(jfk.levels[0].isLightAndVariable, true)
        XCTAssertEqual(jfk.level(nearest: 30000), WindLevel(altitudeFt: 30000, directionDeg: 250, speedKt: 102, temperatureC: -50))

        XCTAssertEqual(WindsAloftParser.decode("7799", altitudeFt: 39000)?.speedKt, 199)
        XCTAssertEqual(WindsAloftParser.decode("0512+15", altitudeFt: 9000)?.directionDeg, 50)
        XCTAssertNil(WindsAloftParser.decode("abc", altitudeFt: 9000))
    }

    func testOpenMeteoMultiAndSingle() throws {
        let requested = [GeoPoint(latitude: 45, longitude: 9), GeoPoint(latitude: 50, longitude: 10), GeoPoint(latitude: 55, longitude: 11)]
        let samples = try OpenMeteoParser.parse(CoreFixtures.data("openmeteo.json"), requested: requested)
        XCTAssertEqual(samples.count, 2) // third location has no data
        XCTAssertEqual(samples[0].point, requested[0])
        XCTAssertEqual(samples[0].speedKt, 87.4, accuracy: 1e-9)
        XCTAssertEqual(samples[0].directionDeg, 265)
        XCTAssertEqual(samples[0].temperatureC ?? 0, -52.3, accuracy: 1e-9)
        XCTAssertEqual(samples[0].altitudeFt, 34000)
        XCTAssertNil(samples[1].temperatureC)

        let single = Data(#"{"latitude": 41.75, "longitude": 12.25, "hourly": {"wind_speed_250hPa": [55.5], "wind_direction_250hPa": [300], "temperature_250hPa": [-48]}}"#.utf8)
        let one = try OpenMeteoParser.parse(single)
        XCTAssertEqual(one.count, 1)
        XCTAssertEqual(one[0].point, GeoPoint(latitude: 41.75, longitude: 12.25))
        XCTAssertThrowsError(try OpenMeteoParser.parse(Data("nope".utf8)))

        let grid = WeatherClient.grid(in: GeoBounds(minLat: 40, maxLat: 50, minLon: 5, maxLon: 15), spacingDegrees: 5)
        XCTAssertEqual(grid.count, 9)
        let wrapped = WeatherClient.grid(in: GeoBounds(minLat: -10, maxLat: 0, minLon: 170, maxLon: -170), spacingDegrees: 10)
        XCTAssertEqual(wrapped.count, 6)
        XCTAssertTrue(wrapped.allSatisfy(\.isValid))
    }
}
