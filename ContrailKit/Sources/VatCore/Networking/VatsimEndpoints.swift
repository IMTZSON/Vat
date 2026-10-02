import Foundation

/// Endpoint constants and URL builders for VATSIM and the third-party services used by Contrail.
/// See PLAN.md §4 and DECISIONS D-010 for the polling frequencies.
public enum VatsimEndpoints {
    // MARK: VATSIM data

    /// Service discovery document (`data.v3[]`, `data.transceivers[]`, `metar[]`, `user[]`).
    public static let status = URL(string: "https://status.vatsim.net/status.json")!
    /// Fallback data feed v3 when status.json is unavailable.
    public static let fallbackFeed = URL(string: "https://data.vatsim.net/v3/vatsim-data.json")!
    /// Fallback transceivers (audio) feed.
    public static let fallbackTransceivers = URL(string: "https://data.vatsim.net/v3/transceivers-data.json")!
    /// METAR service base; append one ICAO or a comma-separated list.
    public static let metarBase = URL(string: "https://metar.vatsim.net/")!
    /// ATC bookings API.
    public static let bookings = URL(string: "https://atc-bookings.vatsim.net/api/booking")!
    /// Upcoming / running events.
    public static let events = URL(string: "https://my.vatsim.net/api/v2/events/latest")!
    /// Map data manifest (VATSpy data URLs + commit hash).
    public static let mapData = URL(string: "https://api.vatsim.net/api/map_data/")!

    // MARK: Boundaries

    /// SimAware TRACON boundaries, latest release.
    public static let simAwareTRACON = URL(
        string: "https://github.com/vatsimnetwork/simaware-tracon-project/releases/latest/download/TRACONBoundaries.geojson")!
    /// VATSpy data project raw files (fallback when the map data manifest is unavailable).
    public static let vatspyDatRaw = URL(
        string: "https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat")!
    public static let vatspyBoundariesRaw = URL(
        string: "https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson")!

    // MARK: Weather

    /// RainViewer radar manifest.
    public static let rainViewer = URL(string: "https://api.rainviewer.com/public/weather-maps.json")!
    /// International SIGMETs (GeoJSON).
    public static let internationalSigmets = URL(string: "https://aviationweather.gov/api/data/isigmet?format=geojson")!
    /// US AIRMETs/SIGMETs (GeoJSON).
    public static let airSigmets = URL(string: "https://aviationweather.gov/api/data/airsigmet?format=geojson")!
    /// US winds and temperatures aloft (FD text).
    public static let windsAloftHigh = URL(string: "https://aviationweather.gov/api/data/windtemp?region=all&level=high&fcst=06")!
    /// Low-level FD winds (3000–39000 ft).
    public static let windsAloftLow = URL(string: "https://aviationweather.gov/api/data/windtemp?region=all&level=low&fcst=06")!

    // MARK: URL builders

    /// METAR for one or more stations (`https://metar.vatsim.net/LIRF,LIML`).
    public static func metar(_ icaos: [String]) -> URL {
        let ids = icaos.map { $0.uppercased().filter { $0.isLetter || $0.isNumber } }.filter { !$0.isEmpty }
        return metarBase.appendingPathComponent(ids.joined(separator: ","))
    }

    /// Bookings with optional filters (`date` is formatted `yyyy-MM-dd` in UTC).
    public static func bookings(date: Date? = nil, type: ATCBooking.Kind? = nil, division: String? = nil,
                                subdivision: String? = nil) -> URL {
        var items: [URLQueryItem] = []
        if let date { items.append(URLQueryItem(name: "date", value: String(FastISO8601.string(from: date).prefix(10)))) }
        if let type { items.append(URLQueryItem(name: "type", value: type.rawValue)) }
        if let division, !division.isEmpty { items.append(URLQueryItem(name: "division", value: division)) }
        if let subdivision, !subdivision.isEmpty { items.append(URLQueryItem(name: "subdivision", value: subdivision)) }
        return withQuery(bookings, items)
    }

    /// Member statistics (hours per rating).
    public static func memberStats(cid: Int) -> URL {
        URL(string: "https://api.vatsim.net/v2/members/\(cid)/stats")!
    }

    /// Public member details (ratings, region, division).
    public static func member(cid: Int) -> URL {
        URL(string: "https://api.vatsim.net/v2/members/\(cid)")!
    }

    /// Flight plan history of a member.
    public static func memberFlightPlans(cid: Int) -> URL {
        URL(string: "https://api.vatsim.net/v2/members/\(cid)/flightplans")!
    }

    /// Latest SimBrief OFP (JSON v2) by username.
    public static func simBrief(username: String) -> URL {
        withQuery(URL(string: "https://www.simbrief.com/api/xml.fetcher.php")!,
                  [URLQueryItem(name: "username", value: username), URLQueryItem(name: "json", value: "v2")])
    }

    /// Latest SimBrief OFP (JSON v2) by numeric user ID.
    public static func simBrief(userID: String) -> URL {
        withQuery(URL(string: "https://www.simbrief.com/api/xml.fetcher.php")!,
                  [URLQueryItem(name: "userid", value: userID), URLQueryItem(name: "json", value: "v2")])
    }

    /// Open-Meteo 250 hPa (~FL340) wind/temperature for many points in one request.
    public static func openMeteoWinds(_ points: [GeoPoint]) -> URL {
        func fmt(_ v: Double) -> String { String(format: "%.2f", v) }
        return withQuery(URL(string: "https://api.open-meteo.com/v1/forecast")!, [
            URLQueryItem(name: "latitude", value: points.map { fmt($0.latitude) }.joined(separator: ",")),
            URLQueryItem(name: "longitude", value: points.map { fmt($0.longitude) }.joined(separator: ",")),
            URLQueryItem(name: "hourly", value: "wind_speed_250hPa,wind_direction_250hPa,temperature_250hPa"),
            URLQueryItem(name: "wind_speed_unit", value: "kn"),
            URLQueryItem(name: "forecast_hours", value: "1"),
        ])
    }

    static func withQuery(_ url: URL, _ items: [URLQueryItem]) -> URL {
        guard !items.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.queryItems = (components.queryItems ?? []) + items
        return components.url ?? url
    }
}
