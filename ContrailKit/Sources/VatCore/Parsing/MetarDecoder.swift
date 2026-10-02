import Foundation

/// A decoded METAR/SPECI (WMO and US formats). Unknown groups are kept in ``unparsed``.
public struct DecodedMetar: Codable, Sendable, Hashable {
    public struct ObservationTime: Codable, Sendable, Hashable {
        public var day: Int
        public var hour: Int
        public var minute: Int

        public init(day: Int, hour: Int, minute: Int) {
            self.day = day
            self.hour = hour
            self.minute = minute
        }

        /// The observation date nearest to `reference` (handles month boundaries).
        public func date(relativeTo reference: Date) -> Date? {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
            let ref = calendar.dateComponents([.year, .month], from: reference)
            var best: Date?
            for monthOffset in [-1, 0, 1] {
                guard let base = calendar.date(from: DateComponents(year: ref.year, month: ref.month)),
                      let month = calendar.date(byAdding: .month, value: monthOffset, to: base) else { continue }
                var c = calendar.dateComponents([.year, .month], from: month)
                c.day = day
                c.hour = hour
                c.minute = minute
                guard let candidate = calendar.date(from: c), calendar.component(.day, from: candidate) == day else { continue }
                if let current = best, abs(current.timeIntervalSince(reference)) <= abs(candidate.timeIntervalSince(reference)) {
                    continue
                }
                best = candidate
            }
            return best
        }
    }

    public struct Wind: Codable, Sendable, Hashable {
        /// Degrees true; `nil` means variable (VRB).
        public var direction: Int?
        public var speedKt: Int
        public var gustKt: Int?
        public var variableFrom: Int?
        public var variableTo: Int?

        public init(direction: Int?, speedKt: Int, gustKt: Int? = nil, variableFrom: Int? = nil, variableTo: Int? = nil) {
            self.direction = direction
            self.speedKt = speedKt
            self.gustKt = gustKt
            self.variableFrom = variableFrom
            self.variableTo = variableTo
        }

        public var isCalm: Bool { speedKt == 0 && (gustKt ?? 0) == 0 }
        public var isVariable: Bool { direction == nil }
    }

    public struct Visibility: Codable, Sendable, Hashable {
        public var meters: Double
        /// "P6SM", "9999", CAVOK: at least this value.
        public var isAtLeast: Bool
        /// "M1/4SM": less than this value.
        public var isLessThan: Bool
        /// Original value in statute miles when reported in SM.
        public var statuteMiles: Double?

        public init(meters: Double, isAtLeast: Bool = false, isLessThan: Bool = false, statuteMiles: Double? = nil) {
            self.meters = meters
            self.isAtLeast = isAtLeast
            self.isLessThan = isLessThan
            self.statuteMiles = statuteMiles
        }

        public var miles: Double { statuteMiles ?? meters / 1609.344 }
    }

    public struct RunwayVisualRange: Codable, Sendable, Hashable {
        public var runway: String
        public var value: Int
        public var maxValue: Int?
        /// True when reported in feet (US), otherwise metres.
        public var inFeet: Bool
        public var isAbove: Bool
        public var isBelow: Bool
        /// "U" up, "D" down, "N" no change.
        public var trend: String?

        public init(runway: String, value: Int, maxValue: Int? = nil, inFeet: Bool = false, isAbove: Bool = false,
                    isBelow: Bool = false, trend: String? = nil) {
            self.runway = runway
            self.value = value
            self.maxValue = maxValue
            self.inFeet = inFeet
            self.isAbove = isAbove
            self.isBelow = isBelow
            self.trend = trend
        }
    }

    public struct WeatherPhenomenon: Codable, Sendable, Hashable {
        public enum Intensity: String, Codable, Sendable, Hashable { case light, moderate, heavy, vicinity }

        public var intensity: Intensity
        /// "MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ" or `nil`.
        public var descriptor: String?
        /// Two-letter codes: "RA", "SN", "BR"…
        public var phenomena: [String]
        public var raw: String

        public init(intensity: Intensity = .moderate, descriptor: String? = nil, phenomena: [String], raw: String = "") {
            self.intensity = intensity
            self.descriptor = descriptor
            self.phenomena = phenomena
            self.raw = raw
        }
    }

    public struct CloudLayer: Codable, Sendable, Hashable {
        public enum Cover: String, Codable, Sendable, Hashable {
            case few = "FEW", scattered = "SCT", broken = "BKN", overcast = "OVC", verticalVisibility = "VV"
            case noSignificant = "NSC", noneDetected = "NCD", skyClear = "SKC", clear = "CLR"
        }

        public var cover: Cover
        public var baseFt: Int?
        /// "CB" or "TCU".
        public var type: String?

        public init(cover: Cover, baseFt: Int? = nil, type: String? = nil) {
            self.cover = cover
            self.baseFt = baseFt
            self.type = type
        }

        /// BKN, OVC and VV form a ceiling.
        public var isCeiling: Bool { cover == .broken || cover == .overcast || cover == .verticalVisibility }
    }

    public enum FlightCategory: String, Codable, Sendable, Hashable, CaseIterable {
        case vfr = "VFR", mvfr = "MVFR", ifr = "IFR", lifr = "LIFR"
    }

    public var raw: String
    public var station: String
    public var time: ObservationTime?
    public var isAuto: Bool
    public var isCorrection: Bool
    public var wind: Wind?
    public var visibility: Visibility?
    public var isCAVOK: Bool
    public var runwayVisualRanges: [RunwayVisualRange]
    public var weather: [WeatherPhenomenon]
    public var clouds: [CloudLayer]
    public var temperatureC: Int?
    public var dewpointC: Int?
    public var qnhHpa: Int?
    public var altimeterInHg: Double?
    /// Trend part ("NOSIG", "TEMPO 3000 SHRA", "BECMG …"), raw.
    public var trend: String?
    /// Remarks after "RMK", raw.
    public var remarks: String?
    public var unparsed: [String]

    public init(raw: String, station: String) {
        self.raw = raw
        self.station = station
        time = nil
        isAuto = false
        isCorrection = false
        wind = nil
        visibility = nil
        isCAVOK = false
        runwayVisualRanges = []
        weather = []
        clouds = []
        temperatureC = nil
        dewpointC = nil
        qnhHpa = nil
        altimeterInHg = nil
        trend = nil
        remarks = nil
        unparsed = []
    }

    /// Visibility in metres (CAVOK → 10 000).
    public var visibilityMeters: Double? { visibility?.meters }

    /// Lowest BKN/OVC/VV layer base in feet.
    public var ceilingFt: Int? {
        clouds.filter(\.isCeiling).compactMap(\.baseFt).min()
    }

    /// FAA flight category from ceiling and visibility (`nil` when neither is known).
    public var flightCategory: FlightCategory? {
        if isCAVOK { return .vfr }
        let ceiling = ceilingFt
        let miles = visibility?.miles
        let hasSkyInfo = !clouds.isEmpty
        guard ceiling != nil || miles != nil || hasSkyInfo else { return nil }
        func category(ceiling: Int?) -> FlightCategory {
            guard let c = ceiling else { return .vfr }
            if c < 500 { return .lifr }
            if c < 1000 { return .ifr }
            if c <= 3000 { return .mvfr }
            return .vfr
        }
        func category(miles: Double?) -> FlightCategory {
            guard let m = miles else { return .vfr }
            if m < 1 { return .lifr }
            if m < 3 { return .ifr }
            if m <= 5 { return .mvfr }
            return .vfr
        }
        let a = category(ceiling: ceiling), b = category(miles: miles)
        let order: [FlightCategory] = [.lifr, .ifr, .mvfr, .vfr]
        return order.first { $0 == a || $0 == b }
    }

    /// Relative humidity in percent (Magnus formula).
    public var relativeHumidity: Double? {
        guard let t = temperatureC.map(Double.init), let td = dewpointC.map(Double.init) else { return nil }
        let a = 17.625, b = 243.04
        let rh = 100 * exp(a * td / (b + td)) / exp(a * t / (b + t))
        return min(100, max(0, rh))
    }
}

/// Parses raw METAR/SPECI strings into ``DecodedMetar``.
public enum MetarDecoder {
    static let descriptors: Set<String> = ["MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ"]
    static let phenomenaCodes: Set<String> = [
        "DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP", "BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY",
        "PO", "SQ", "FC", "SS", "DS",
    ]

    /// Decodes `raw`. Returns `nil` only when no station identifier can be found.
    public static func decode(_ raw: String) -> DecodedMetar? {
        let text = raw.replacingOccurrences(of: "=", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        var tokens = text.split(whereSeparator: \.isWhitespace).map(String.init)
        while let first = tokens.first, ["METAR", "SPECI"].contains(first) { tokens.removeFirst() }
        if tokens.first == "COR" { tokens.removeFirst() }
        guard let station = tokens.first, station.count == 4, station.allSatisfy({ $0.isLetter || $0.isNumber }),
              station.first?.isLetter == true else { return nil }
        var metar = DecodedMetar(raw: text, station: station.uppercased())
        var i = 1

        // Trend / remarks sections.
        var body: [String] = []
        var trendTokens: [String] = []
        var remarkTokens: [String] = []
        var section = 0
        while i < tokens.count {
            let token = tokens[i]
            if token == "RMK" { section = 2; i += 1; continue }
            if section < 2, ["NOSIG", "TEMPO", "BECMG"].contains(token) { section = 1 }
            switch section {
            case 0: body.append(token)
            case 1: trendTokens.append(token)
            default: remarkTokens.append(token)
            }
            i += 1
        }
        if !trendTokens.isEmpty { metar.trend = trendTokens.joined(separator: " ") }
        if !remarkTokens.isEmpty { metar.remarks = remarkTokens.joined(separator: " ") }

        var j = 0
        while j < body.count {
            let token = body[j]
            defer { j += 1 }
            if metar.time == nil, let time = parseTime(token) { metar.time = time; continue }
            if token == "AUTO" { metar.isAuto = true; continue }
            if token == "COR" || token == "CC" { metar.isCorrection = true; continue }
            if token == "NIL" { continue }
            if metar.wind == nil, let wind = parseWind(token) { metar.wind = wind; continue }
            if let (from, to) = parseWindVariation(token), metar.wind != nil {
                metar.wind?.variableFrom = from
                metar.wind?.variableTo = to
                continue
            }
            if token == "CAVOK" {
                metar.isCAVOK = true
                metar.visibility = .init(meters: 10_000, isAtLeast: true)
                continue
            }
            // "1 1/2SM": whole number followed by a fraction in statute miles.
            if metar.visibility == nil, j + 1 < body.count, let whole = Int(token), whole < 10,
               body[j + 1].hasSuffix("SM"), let frac = parseStatuteMiles(body[j + 1]) {
                let miles = Double(whole) + frac.miles
                metar.visibility = .init(meters: miles * 1609.344, isAtLeast: frac.atLeast, isLessThan: frac.lessThan, statuteMiles: miles)
                j += 1
                continue
            }
            if token.hasSuffix("SM"), let sm = parseStatuteMiles(token) {
                if metar.visibility == nil {
                    metar.visibility = .init(meters: sm.miles * 1609.344, isAtLeast: sm.atLeast, isLessThan: sm.lessThan,
                                             statuteMiles: sm.miles)
                }
                continue
            }
            if let meters = parseMetricVisibility(token) {
                // The second group is a minimum visibility with direction: keep the prevailing one.
                if metar.visibility == nil {
                    metar.visibility = .init(meters: Double(meters == 9999 ? 10_000 : meters), isAtLeast: meters == 9999)
                }
                continue
            }
            if let rvr = parseRVR(token) { metar.runwayVisualRanges.append(rvr); continue }
            if let layer = parseCloud(token) { metar.clouds.append(layer); continue }
            if let (t, d) = parseTemperature(token) { metar.temperatureC = t; metar.dewpointC = d; continue }
            if let qnh = parseAltimeter(token) {
                if let hpa = qnh.hpa { metar.qnhHpa = hpa; metar.altimeterInHg = metar.altimeterInHg ?? Self.round2(Double(hpa) / 33.8639) }
                if let inHg = qnh.inHg { metar.altimeterInHg = inHg; metar.qnhHpa = metar.qnhHpa ?? Int((inHg * 33.8639).rounded()) }
                continue
            }
            if let phenomenon = parseWeather(token) { metar.weather.append(phenomenon); continue }
            metar.unparsed.append(token)
        }
        return metar
    }

    // MARK: - Groups

    static func parseTime(_ t: String) -> DecodedMetar.ObservationTime? {
        guard t.count == 7, t.hasSuffix("Z"), let v = Int(t.prefix(6)) else { return nil }
        let day = v / 10000, hour = v / 100 % 100, minute = v % 100
        guard (1...31).contains(day), hour < 24, minute < 60 else { return nil }
        return .init(day: day, hour: hour, minute: minute)
    }

    static func parseWind(_ t: String) -> DecodedMetar.Wind? {
        var unitFactor = 1.0
        var body = Substring(t)
        if body.hasSuffix("KT") { body = body.dropLast(2) }
        else if body.hasSuffix("MPS") { body = body.dropLast(3); unitFactor = 1.943844 }
        else if body.hasSuffix("KMH") { body = body.dropLast(3); unitFactor = 0.539957 }
        else { return nil }
        guard body.count >= 5 else { return nil }
        let dirPart = body.prefix(3)
        var rest = body.dropFirst(3)
        let direction: Int?
        if dirPart == "VRB" { direction = nil }
        else if dirPart == "///" { direction = nil }
        else if let d = Int(dirPart), d <= 360 { direction = d }
        else { return nil }
        var gustPart: Substring?
        if let g = rest.firstIndex(of: "G") {
            gustPart = rest[rest.index(after: g)...]
            rest = rest[..<g]
        }
        guard rest.count >= 2, rest.count <= 3 else {
            if rest.allSatisfy({ $0 == "/" }) { return .init(direction: direction, speedKt: 0) }
            return nil
        }
        guard let speed = Int(rest) else {
            return rest.allSatisfy({ $0 == "/" }) ? .init(direction: direction, speedKt: 0) : nil
        }
        let gust = gustPart.flatMap { Int($0) }
        if gustPart != nil, gust == nil { return nil }
        func kt(_ v: Int) -> Int { Int((Double(v) * unitFactor).rounded()) }
        return .init(direction: speed == 0 && direction == 0 ? 0 : direction, speedKt: kt(speed), gustKt: gust.map(kt))
    }

    static func parseWindVariation(_ t: String) -> (Int, Int)? {
        let parts = t.split(separator: "V")
        guard t.count == 7, parts.count == 2, parts[0].count == 3, parts[1].count == 3,
              let a = Int(parts[0]), let b = Int(parts[1]), a <= 360, b <= 360 else { return nil }
        return (a, b)
    }

    static func parseStatuteMiles(_ t: String) -> (miles: Double, atLeast: Bool, lessThan: Bool)? {
        guard t.hasSuffix("SM") else { return nil }
        var body = t.dropLast(2)
        var atLeast = false, lessThan = false
        if body.hasPrefix("P") { atLeast = true; body = body.dropFirst() }
        if body.hasPrefix("M") { lessThan = true; body = body.dropFirst() }
        if let slash = body.firstIndex(of: "/") {
            guard let num = Double(body[..<slash]), let den = Double(body[body.index(after: slash)...]), den > 0 else { return nil }
            return (num / den, atLeast, lessThan)
        }
        guard let v = Double(body) else { return nil }
        return (v, atLeast, lessThan)
    }

    static func parseMetricVisibility(_ t: String) -> Int? {
        var body = Substring(t)
        if body.hasSuffix("NDV") { body = body.dropLast(3) }
        for direction in ["NE", "NW", "SE", "SW", "N", "S", "E", "W"] where body.count > 4 && body.hasSuffix(direction) {
            body = body.dropLast(direction.count)
            break
        }
        guard body.count == 4, body.allSatisfy(\.isNumber), let v = Int(body) else { return nil }
        return v
    }

    static func parseRVR(_ t: String) -> DecodedMetar.RunwayVisualRange? {
        guard t.hasPrefix("R"), let slash = t.firstIndex(of: "/") else { return nil }
        let runway = String(t[t.index(after: t.startIndex)..<slash])
        guard (2...3).contains(runway.count), runway.prefix(2).allSatisfy(\.isNumber) else { return nil }
        var body = t[t.index(after: slash)...]
        var inFeet = false
        var trend: String?
        if let last = body.last, ["U", "D", "N"].contains(last) {
            trend = String(last)
            body = body.dropLast()
            if body.hasSuffix("/") { body = body.dropLast() }
        }
        if body.hasSuffix("FT") { inFeet = true; body = body.dropLast(2) }
        let parts = body.split(separator: "V", maxSplits: 1)
        func value(_ s: Substring) -> (Int, Bool, Bool)? {
            var s = s
            var above = false, below = false
            if s.hasPrefix("P") { above = true; s = s.dropFirst() }
            if s.hasPrefix("M") { below = true; s = s.dropFirst() }
            guard s.count == 4, let v = Int(s) else { return nil }
            return (v, above, below)
        }
        guard let first = parts.first, let a = value(first) else { return nil }
        let b = parts.count > 1 ? value(parts[1]) : nil
        return .init(runway: runway, value: a.0, maxValue: b?.0, inFeet: inFeet, isAbove: a.1 || (b?.1 ?? false),
                     isBelow: a.2, trend: trend)
    }

    static func parseCloud(_ t: String) -> DecodedMetar.CloudLayer? {
        switch t {
        case "NSC": return .init(cover: .noSignificant)
        case "NCD": return .init(cover: .noneDetected)
        case "SKC": return .init(cover: .skyClear)
        case "CLR": return .init(cover: .clear)
        default: break
        }
        let coverCode: String
        if t.hasPrefix("VV") { coverCode = "VV" } else { coverCode = String(t.prefix(3)) }
        guard let cover = DecodedMetar.CloudLayer.Cover(rawValue: coverCode),
              [.few, .scattered, .broken, .overcast, .verticalVisibility].contains(cover) else { return nil }
        let rest = t.dropFirst(coverCode.count)
        let heightPart = rest.prefix(3)
        guard heightPart.count == 3 else { return nil }
        let base: Int?
        if heightPart == "///" { base = nil }
        else if let h = Int(heightPart) { base = h * 100 }
        else { return nil }
        let typePart = String(rest.dropFirst(3))
        let type: String?
        switch typePart {
        case "CB", "TCU": type = typePart
        case "", "///": type = nil
        default: return nil
        }
        return .init(cover: cover, baseFt: base, type: type)
    }

    static func parseTemperature(_ t: String) -> (Int?, Int?)? {
        let parts = t.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return nil }
        func value(_ s: Substring) -> Int?? {
            if s.isEmpty || s.allSatisfy({ $0 == "X" || $0 == "/" }) { return .some(nil) }
            var s = s
            var sign = 1
            if s.hasPrefix("M") { sign = -1; s = s.dropFirst() }
            guard s.count == 2, let v = Int(s) else { return nil }
            return .some(sign * v)
        }
        guard let temperature = value(parts[0]), let dewpoint = value(parts[1]) else { return nil }
        guard temperature != nil || dewpoint != nil else { return nil }
        return (temperature, dewpoint)
    }

    static func parseAltimeter(_ t: String) -> (hpa: Int?, inHg: Double?)? {
        guard t.count == 5, let v = Int(t.dropFirst()) else { return nil }
        if t.hasPrefix("Q") { return (v, nil) }
        if t.hasPrefix("A") { return (nil, Double(v) / 100) }
        return nil
    }

    static func parseWeather(_ t: String) -> DecodedMetar.WeatherPhenomenon? {
        var body = Substring(t)
        var intensity = DecodedMetar.WeatherPhenomenon.Intensity.moderate
        if body.hasPrefix("+") { intensity = .heavy; body = body.dropFirst() }
        else if body.hasPrefix("-") { intensity = .light; body = body.dropFirst() }
        else if body.hasPrefix("VC") { intensity = .vicinity; body = body.dropFirst(2) }
        var descriptor: String?
        if body.count >= 2, descriptors.contains(String(body.prefix(2))) {
            descriptor = String(body.prefix(2))
            body = body.dropFirst(2)
        }
        guard body.count % 2 == 0 else { return nil }
        var phenomena: [String] = []
        while !body.isEmpty {
            let code = String(body.prefix(2))
            guard phenomenaCodes.contains(code) else { return nil }
            phenomena.append(code)
            body = body.dropFirst(2)
        }
        guard descriptor != nil || !phenomena.isEmpty else { return nil }
        return .init(intensity: intensity, descriptor: descriptor, phenomena: phenomena, raw: t)
    }

    static func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
}
