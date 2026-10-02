import Foundation
@testable import VatCore

/// Shared in-memory fixtures for the logic tests (no dependency on the bundled databases).
enum LogicFixtures {
    static let lirf = Airport(icao: "LIRF", name: "Roma Fiumicino", latitude: 41.8003, longitude: 12.2389, elevationFt: 15, country: "IT")
    static let lira = Airport(icao: "LIRA", name: "Roma Ciampino", latitude: 41.7994, longitude: 12.5949, elevationFt: 427, country: "IT")
    static let liml = Airport(icao: "LIML", name: "Milano Linate", latitude: 45.4451, longitude: 9.2767, elevationFt: 353, country: "IT")
    static let egll = Airport(icao: "EGLL", name: "London Heathrow", latitude: 51.4706, longitude: -0.4619, elevationFt: 83, country: "GB")
    static let eddf = Airport(icao: "EDDF", name: "Frankfurt", latitude: 50.0333, longitude: 8.5706, elevationFt: 364, country: "DE")
    static let lfpg = Airport(icao: "LFPG", name: "Paris CDG", latitude: 49.0097, longitude: 2.5479, elevationFt: 392, country: "FR")
    static let eham = Airport(icao: "EHAM", name: "Amsterdam", latitude: 52.3086, longitude: 4.7639, elevationFt: -11, country: "NL")
    static let lemd = Airport(icao: "LEMD", name: "Madrid", latitude: 40.4719, longitude: -3.5626, elevationFt: 1998, country: "ES")
    static let loww = Airport(icao: "LOWW", name: "Wien", latitude: 48.1103, longitude: 16.5697, elevationFt: 600, country: "AT")
    static let lgav = Airport(icao: "LGAV", name: "Athens", latitude: 37.9364, longitude: 23.9445, elevationFt: 308, country: "GR")
    static let engm = Airport(icao: "ENGM", name: "Oslo", latitude: 60.1939, longitude: 11.1004, elevationFt: 681, country: "NO")
    static let ensb = Airport(icao: "ENSB", name: "Svalbard", latitude: 78.2461, longitude: 15.4656, elevationFt: 88, country: "NO")
    static let bikf = Airport(icao: "BIKF", name: "Keflavik", latitude: 63.985, longitude: -22.6056, elevationFt: 171, country: "IS")
    static let kjfk = Airport(icao: "KJFK", name: "New York JFK", latitude: 40.6398, longitude: -73.7789, elevationFt: 13, country: "US")
    static let klax = Airport(icao: "KLAX", name: "Los Angeles", latitude: 33.9425, longitude: -118.408, elevationFt: 125, country: "US")
    static let rjtt = Airport(icao: "RJTT", name: "Tokyo Haneda", latitude: 35.5523, longitude: 139.78, elevationFt: 35, country: "JP")
    static let yssy = Airport(icao: "YSSY", name: "Sydney", latitude: -33.946, longitude: 151.177, elevationFt: 21, country: "AU")
    static let wsss = Airport(icao: "WSSS", name: "Singapore", latitude: 1.3502, longitude: 103.994, elevationFt: 22, country: "SG")
    static let omdb = Airport(icao: "OMDB", name: "Dubai", latitude: 25.2528, longitude: 55.3644, elevationFt: 62, country: "AE")
    static let lszb = Airport(icao: "LSZB", name: "Bern", latitude: 46.9141, longitude: 7.4971, elevationFt: 1674, country: "CH")
    static let lirn = Airport(icao: "LIRN", name: "Napoli", latitude: 40.886, longitude: 14.2908, elevationFt: 294, country: "IT")
    static let lipz = Airport(icao: "LIPZ", name: "Venezia", latitude: 45.5053, longitude: 12.3519, elevationFt: 7, country: "IT")

    static let airports: [Airport] = [
        lirf, lira, liml, egll, eddf, lfpg, eham, lemd, loww, lgav, engm, ensb, bikf, kjfk, klax, rjtt, yssy, wsss,
        omdb, lszb, lirn, lipz,
    ]
    static let byICAO: [String: Airport] = Dictionary(uniqueKeysWithValues: airports.map { ($0.icao, $0) })
    static func airport(_ icao: String) -> Airport? { byICAO[icao] }
    static func nearest(_ p: GeoPoint) -> Airport? {
        airports.min { $0.position.distance(to: p) < $1.position.distance(to: p) }
    }

    static func date(_ iso: String) -> Date { FastISO8601.parse(iso)! }

    static func plan(_ dep: String, _ arr: String, route: String = "", type: String = "A320", tas: String = "N0450",
                     altitude: String = "FL360", deptime: String = "", enroute: String = "") -> FlightPlan {
        FlightPlan(aircraft: "\(type)/M-SDE2E3FGHIRWY/LB1", aircraftShort: type, departure: dep, arrival: arr,
                   cruiseTAS: tas, altitude: altitude, deptime: deptime, enrouteTime: enroute, route: route)
    }

    static func pilot(_ callsign: String = "TEST1", cid: Int = 1_000_001, at p: GeoPoint, altitude: Int, gs: Int,
                      heading: Int = 0, plan: FlightPlan? = nil) -> Pilot {
        Pilot(cid: cid, name: "Test Pilot", callsign: callsign, latitude: p.latitude, longitude: p.longitude,
              altitude: altitude, groundspeed: gs, heading: heading, flightPlan: plan)
    }
}
