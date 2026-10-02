import Foundation
import VatCore

extension AppServices {
    /// Offline services for previews: every request fails fast with `NetworkError.offline`.
    nonisolated static func preview() -> AppServices {
        let http = StubHTTPClient(routes: [:])
        let cache = ResponseCache.inMemory()
        let discovery = StatusDiscovery(http: http, cache: cache)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("contrail-preview")
        return AppServices(
            http: http, cache: cache, discovery: discovery,
            feed: FeedService(http: http, discovery: discovery, cache: nil),
            transceivers: TransceiversClient(http: http, cache: cache, discovery: discovery),
            metar: MetarClient(http: http, cache: cache),
            bookings: BookingsClient(http: http, cache: cache),
            events: EventsClient(http: http, cache: cache),
            member: MemberClient(http: http, cache: cache),
            simBrief: SimBriefClient(http: http, cache: cache),
            weather: WeatherClient(http: http, cache: cache),
            mapData: MapDataClient(http: http, directory: dir, bundled: BundledData.mapFiles)
        )
    }
}

/// Sample network state used by previews.
nonisolated enum PreviewData {
    static let feed: VatsimFeed = {
        let plan = FlightPlan(flightRules: "I", aircraft: "A320/M-SDE2E3FGHIJ1RWXY/LB1", aircraftShort: "A320",
                              departure: "LIRF", arrival: "EGLL", alternate: "EGKK", cruiseTAS: "450",
                              altitude: "36000", deptime: "0830", enrouteTime: "0230", fuelTime: "0400",
                              route: "RAVAL UM728 ELB DCT BASTIA", revisionID: 1)
        let pilots = [
            Pilot(cid: 1_234_567, name: "Mario Rossi", callsign: "AZA123", latitude: 43.6, longitude: 9.4,
                  altitude: 36_000, groundspeed: 452, transponder: "2341", heading: 315, flightPlan: plan,
                  logonTime: .now.addingTimeInterval(-5400), lastUpdated: .now),
            Pilot(cid: 7_654_321, name: "Anna Bianchi", callsign: "ITY456", latitude: 41.80, longitude: 12.25,
                  altitude: 15, groundspeed: 12, heading: 160,
                  flightPlan: FlightPlan(aircraftShort: "A21N", departure: "LIRF", arrival: "LIML", altitude: "FL340",
                                         deptime: "1930", enrouteTime: "0105", route: "DCT"),
                  logonTime: .now.addingTimeInterval(-900), lastUpdated: .now),
            Pilot(cid: 1_111_111, name: "John Smith", callsign: "BAW9", latitude: 51.2, longitude: -1.2,
                  altitude: 8_500, groundspeed: 250, heading: 80,
                  flightPlan: FlightPlan(aircraftShort: "B77W", departure: "KJFK", arrival: "EGLL", altitude: "FL370",
                                         route: "DCT"),
                  logonTime: .now.addingTimeInterval(-25_000), lastUpdated: .now),
        ]
        let controllers = [
            Controller(cid: 2_222_222, name: "Luigi Verdi", callsign: "LIRR_CTR", frequency: "125.500", facility: .center,
                       rating: 5, visualRange: 600, textAtis: ["Roma Control"], logonTime: .now.addingTimeInterval(-7200)),
            Controller(cid: 3_333_333, name: "Sara Neri", callsign: "LIRF_TWR", frequency: "118.700", facility: .tower,
                       rating: 3, visualRange: 50, logonTime: .now.addingTimeInterval(-3600)),
        ]
        let atis = [
            Controller(cid: 4_444_444, name: "ATIS", callsign: "LIRF_ATIS", frequency: "121.700", facility: .tower,
                       rating: 3, atisCode: "K",
                       textAtis: ["ROMA FIUMICINO INFORMATION K", "RWY 16L FOR LDG 16R FOR TKOF", "QNH 1015"]),
        ]
        return VatsimFeed(general: FeedGeneral(updateTimestamp: .now, connectedClients: 6, uniqueUsers: 6),
                          pilots: pilots, controllers: controllers, atis: atis)
    }()

    static let events: [VatsimEvent] = [
        VatsimEvent(id: 1, name: "Italian Night Ops", airports: ["LIRF", "LIML"],
                    routes: [.init(departure: "LIRF", arrival: "LIML", route: "DCT")],
                    start: .now.addingTimeInterval(3 * 3600), end: .now.addingTimeInterval(6 * 3600),
                    shortDescription: "Rome and Milan fully staffed"),
    ]

    static let bookings: [ATCBooking] = [
        ATCBooking(id: 1, cid: 5_555_555, callsign: "LIML_TWR", start: .now.addingTimeInterval(1800),
                   end: .now.addingTimeInterval(3 * 3600), division: "EUD", subdivision: "ITA"),
    ]
}
