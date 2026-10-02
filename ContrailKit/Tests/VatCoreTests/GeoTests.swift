import XCTest
@testable import VatCore

final class GeoTests: XCTestCase {
    let lirf = GeoPoint(latitude: 41.8003, longitude: 12.2389)
    let egll = GeoPoint(latitude: 51.4706, longitude: -0.4619)

    func testDistanceAndBearing() {
        XCTAssertEqual(lirf.distance(to: egll), 780, accuracy: 6)
        XCTAssertEqual(lirf.bearing(to: egll), 322.4, accuracy: 1)
        XCTAssertEqual(lirf.distance(to: lirf), 0, accuracy: 1e-9)
    }

    func testDestinationRoundTrip() {
        let p = lirf.destination(bearing: 90, distanceNM: 60)
        XCTAssertEqual(lirf.distance(to: p), 60, accuracy: 0.01)
        XCTAssertEqual(lirf.bearing(to: p), 90, accuracy: 1)
    }

    func testIntermediateAndPath() {
        let mid = lirf.intermediate(to: egll, fraction: 0.5)
        XCTAssertEqual(lirf.distance(to: mid), egll.distance(to: mid), accuracy: 0.5)
        let path = lirf.greatCirclePath(to: egll, maxSegmentNM: 100)
        XCTAssertEqual(path.count, 9)
        XCTAssertEqual(path.last!.latitude, egll.latitude, accuracy: 1e-6)
    }

    func testAlongAndCrossTrack() {
        let p = lirf.intermediate(to: egll, fraction: 0.25).destination(bearing: 45, distanceNM: 10)
        XCTAssertEqual(abs(p.crossTrackDistance(from: lirf, to: egll)), 10, accuracy: 3)
        XCTAssertEqual(p.alongTrackDistance(from: lirf, to: egll), lirf.distance(to: egll) * 0.25, accuracy: 10)
    }

    func testPolygonContainsAndHoles() {
        let square = [GeoPoint(latitude: 0, longitude: 0), GeoPoint(latitude: 0, longitude: 10),
                      GeoPoint(latitude: 10, longitude: 10), GeoPoint(latitude: 10, longitude: 0)]
        let hole = [GeoPoint(latitude: 4, longitude: 4), GeoPoint(latitude: 4, longitude: 6),
                    GeoPoint(latitude: 6, longitude: 6), GeoPoint(latitude: 6, longitude: 4)]
        let poly = GeoPolygon(outer: square, holes: [hole])
        XCTAssertTrue(poly.contains(GeoPoint(latitude: 2, longitude: 2)))
        XCTAssertFalse(poly.contains(GeoPoint(latitude: 5, longitude: 5)))
        XCTAssertFalse(poly.contains(GeoPoint(latitude: 11, longitude: 5)))
        XCTAssertEqual(GeoPolygon(outer: square).centroid.latitude, 5, accuracy: 1e-9)
    }

    func testPolygonAcrossAntimeridian() {
        let ring = [GeoPoint(latitude: -10, longitude: 170), GeoPoint(latitude: -10, longitude: -170),
                    GeoPoint(latitude: 10, longitude: -170), GeoPoint(latitude: 10, longitude: 170)]
        let poly = GeoPolygon(outer: ring)
        XCTAssertTrue(poly.bounds.crossesAntimeridian)
        XCTAssertTrue(poly.contains(GeoPoint(latitude: 0, longitude: 179.5)))
        XCTAssertTrue(poly.contains(GeoPoint(latitude: 0, longitude: -175)))
        XCTAssertFalse(poly.contains(GeoPoint(latitude: 0, longitude: 0)))
        XCTAssertFalse(poly.contains(GeoPoint(latitude: 0, longitude: 160)))
    }

    func testBoundsIntersects() {
        let a = GeoBounds(minLat: 0, maxLat: 10, minLon: 170, maxLon: -170)
        let b = GeoBounds(minLat: 5, maxLat: 6, minLon: -175, maxLon: -172)
        let c = GeoBounds(minLat: 5, maxLat: 6, minLon: 0, maxLon: 10)
        XCTAssertTrue(a.intersects(b))
        XCTAssertFalse(a.intersects(c))
    }
}
