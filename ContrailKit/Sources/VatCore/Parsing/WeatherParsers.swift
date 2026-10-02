import Foundation

/// Decodes aviationweather.gov `isigmet` / `airsigmet` GeoJSON FeatureCollections.
public enum SigmetParser {
    /// Parses a FeatureCollection; features without any useful content are skipped.
    /// Geometry may be Polygon, MultiPolygon or missing (other types → `nil`).
    public static func parse(_ data: Data) throws -> [Sigmet] {
        let collection = try GeoJSONFeatureCollection.decode(data)
        var result: [Sigmet] = []
        for (index, feature) in collection.features.enumerated() {
            let p = feature.properties
            func s(_ keys: String...) -> String {
                for key in keys { if let v = p[key]?.stringValue, !v.isEmpty { return v } }
                return ""
            }
            func n(_ keys: String...) -> Int? {
                for key in keys { if let v = p[key]?.intValue { return v } }
                return nil
            }
            func d(_ keys: String...) -> Date? {
                for key in keys { if let v = p[key]?.dateValue { return v } }
                return nil
            }
            let raw = s("rawSigmet", "rawAirSigmet", "rawText", "raw")
            let hazard = s("hazard").uppercased()
            guard !raw.isEmpty || !hazard.isEmpty || feature.geometry != nil else { continue }
            let isUS = p["airSigmetType"] != nil || p["rawAirSigmet"] != nil
            let kind = isUS ? s("airSigmetType").uppercased() : "ISIGMET"
            let firID = s("firId", "icaoId")
            let series = s("seriesId", "alphaChar", "id")
            let validFrom = d("validTimeFrom", "validFrom")
            var id = [kind, firID, series, validFrom.map { String(Int($0.timeIntervalSince1970)) } ?? ""]
                .filter { !$0.isEmpty }.joined(separator: "-")
            if id.isEmpty { id = "SIGMET-\(index)" }
            var base = n("base", "altitudeLow1", "altitudeLow2")
            var top = n("top", "altitudeHi1", "altitudeHi2")
            // Some products report flight levels (hundreds of feet).
            if let b = base, b > 0, b < 1000 { base = b * 100 }
            if let t = top, t > 0, t < 1000 { top = t * 100 }
            result.append(Sigmet(
                id: id, hazard: hazard.isEmpty ? "UNK" : hazard, qualifier: s("qualifier", "severity"),
                firID: firID, firName: s("firName"), validFrom: validFrom, validTo: d("validTimeTo", "validTo"),
                baseFt: base, topFt: top, rawText: raw, kind: kind.isEmpty ? "SIGMET" : kind,
                geometry: feature.geometry
            ))
        }
        // Ensure unique identifiers.
        var seen: [String: Int] = [:]
        for i in result.indices {
            let count = seen[result[i].id, default: 0]
            seen[result[i].id] = count + 1
            if count > 0 { result[i].id += "#\(count)" }
        }
        return result
    }
}

/// Decodes the US FD winds and temperatures aloft text product (aviationweather.gov `windtemp`).
///
/// ```
/// FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
/// BOS 3115 3013-03 2918-07 2724-11 2642-23 2553-34 254149 255055 254662
/// ```
/// - `DDSS`: direction (tens of degrees) and speed; `9900` light and variable;
///   `DD` 51–86 encodes 100–199 kt (direction − 50, speed + 100); `199` kt+ is `DD99`.
/// - Temperatures carry an explicit sign up to 24000 ft and are implied negative above.
/// - Blank columns (levels below station elevation / too close) are missing levels.
public enum WindsAloftParser {
    public static func parse(_ text: String, locate: (String) -> GeoPoint? = { _ in nil }) -> [WindsAloftStation] {
        var levels: [(altitude: Int, end: Int)] = []
        var stations: [WindsAloftStation] = []
        for rawLine in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
            let line = Array(rawLine.replacingOccurrences(of: "\r", with: "").utf8)
            let tokens = tokenize(line)
            guard let first = tokens.first else { continue }
            if first.text == "FT" {
                levels = tokens.dropFirst().compactMap { token in Int(token.text).map { (altitude: $0, end: token.end) } }
                continue
            }
            guard !levels.isEmpty, first.start == 0, first.text.count == 3 || first.text.count == 4,
                  first.text.allSatisfy({ $0.isLetter || $0.isNumber }), first.text.first?.isLetter == true,
                  tokens.count >= 2 else { continue }
            var parsed: [WindLevel] = []
            var usedLevels = Set<Int>()
            for token in tokens.dropFirst() {
                // Assign the token to the header column whose right edge is closest.
                guard let column = levels.enumerated().min(by: { abs($0.element.end - token.end) < abs($1.element.end - token.end) }),
                      abs(column.element.end - token.end) <= 3, !usedLevels.contains(column.offset)
                else { continue }
                usedLevels.insert(column.offset)
                if let level = decode(token.text, altitudeFt: column.element.altitude) { parsed.append(level) }
            }
            guard !parsed.isEmpty else { continue }
            stations.append(WindsAloftStation(id: first.text, position: locate(first.text),
                                              levels: parsed.sorted { $0.altitudeFt < $1.altitudeFt }))
        }
        return stations
    }

    /// Decodes one FD group ("2918-07", "254149", "9900", "7715").
    public static func decode(_ group: String, altitudeFt: Int) -> WindLevel? {
        let chars = Array(group)
        guard chars.count >= 4, let dd = Int(String(chars[0..<2])), let ss = Int(String(chars[2..<4])) else { return nil }
        var temperature: Int?
        if chars.count > 4 {
            let rest = String(chars[4...])
            if rest.hasPrefix("+") || rest.hasPrefix("-") {
                temperature = Int(rest)
            } else if let t = Int(rest) {
                temperature = altitudeFt > 24000 ? -t : t
            }
        }
        if dd == 99 && ss == 0 {
            return WindLevel(altitudeFt: altitudeFt, directionDeg: 0, speedKt: 0, temperatureC: temperature, isLightAndVariable: true)
        }
        var direction = dd * 10
        var speed = ss
        if dd >= 51 && dd <= 86 {
            direction = (dd - 50) * 10
            speed = ss + 100
        }
        guard direction <= 360 else { return nil }
        return WindLevel(altitudeFt: altitudeFt, directionDeg: direction % 360 == 0 ? 360 : direction,
                         speedKt: speed, temperatureC: temperature)
    }

    private struct Token { var text: String; var start: Int; var end: Int }

    private static func tokenize(_ bytes: [UInt8]) -> [Token] {
        var tokens: [Token] = []
        var i = 0
        while i < bytes.count {
            while i < bytes.count, bytes[i] == 0x20 || bytes[i] == 0x09 { i += 1 }
            guard i < bytes.count else { break }
            let start = i
            while i < bytes.count, bytes[i] != 0x20, bytes[i] != 0x09 { i += 1 }
            tokens.append(Token(text: String(decoding: bytes[start..<i], as: UTF8.self), start: start, end: i - 1))
        }
        return tokens
    }
}

/// Decodes Open-Meteo forecast responses (one object, or an array for multiple locations).
public enum OpenMeteoParser {
    /// - Parameter requested: The requested points in order; when the counts match these are used
    ///   instead of the model grid coordinates returned by the API.
    public static func parse(_ data: Data, requested: [GeoPoint] = [], altitudeFt: Int = 34000) throws -> [WindSample] {
        let json: LenientJSON
        do {
            json = try JSONDecoder().decode(LenientJSON.self, from: data)
        } catch {
            throw NetworkError.decoding("Open-Meteo: \(error)")
        }
        let locations: [LenientJSON]
        if let array = json.arrayValue { locations = array } else { locations = [json] }
        var samples: [WindSample] = []
        for (index, location) in locations.enumerated() {
            guard let hourly = location["hourly"],
                  let speed = hourly["wind_speed_250hPa"]?.arrayValue?.first?.doubleValue,
                  let direction = hourly["wind_direction_250hPa"]?.arrayValue?.first?.doubleValue
            else { continue }
            let temperature = hourly["temperature_250hPa"]?.arrayValue?.first?.doubleValue
            let point: GeoPoint
            if requested.count == locations.count {
                point = requested[index]
            } else if let lat = location["latitude"]?.doubleValue, let lon = location["longitude"]?.doubleValue {
                point = GeoPoint(latitude: lat, longitude: lon)
            } else {
                continue
            }
            samples.append(WindSample(point: point, directionDeg: direction, speedKt: speed, temperatureC: temperature,
                                      altitudeFt: altitudeFt))
        }
        return samples
    }
}
