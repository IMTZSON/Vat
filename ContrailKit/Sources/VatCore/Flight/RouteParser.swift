import Foundation

/// Speed/level group of an ICAO route ("N0450F350", "M078F370", "K0830S1130").
public struct SpeedLevel: Codable, Sendable, Hashable {
    public var raw: String
    /// True airspeed in knots (Mach converted with ≈573 kt per Mach at cruise levels).
    public var speedKnots: Int?
    public var mach: Double?
    /// Level in feet (metric levels converted).
    public var altitudeFt: Int?

    public init(raw: String, speedKnots: Int? = nil, mach: Double? = nil, altitudeFt: Int? = nil) {
        self.raw = raw
        self.speedKnots = speedKnots
        self.mach = mach
        self.altitudeFt = altitudeFt
    }

    /// Parses "N0450F350", "M078F350", "K0830S1130", "N0120A045", "N0450VFR". Returns `nil` if not a speed/level group.
    public init?(_ string: String) {
        let s = Array(string.uppercased().utf8)
        guard s.count >= 5 else { return nil }
        var i = 0
        func digits(_ n: Int) -> Int? {
            guard i + n <= s.count else { return nil }
            var v = 0
            for k in 0..<n {
                let c = s[i + k]
                guard c >= 0x30, c <= 0x39 else { return nil }
                v = v * 10 + Int(c - 0x30)
            }
            i += n
            return v
        }
        var knots: Int?
        var mach: Double?
        switch s[0] {
        case UInt8(ascii: "N"): i = 1; guard let v = digits(4) else { return nil }; knots = v
        case UInt8(ascii: "K"): i = 1; guard let v = digits(4) else { return nil }; knots = Int((Double(v) / 1.852).rounded())
        case UInt8(ascii: "M"): i = 1; guard let v = digits(3) else { return nil }; mach = Double(v) / 100; knots = Int(Double(v) / 100 * 573)
        default: return nil
        }
        guard i < s.count else { return nil }
        var altitude: Int?
        let rest = String(decoding: s[i...], as: UTF8.self)
        switch s[i] {
        case UInt8(ascii: "F"), UInt8(ascii: "A"):
            i += 1
            guard let v = digits(3), i == s.count else { return nil }
            altitude = v * 100
        case UInt8(ascii: "S"), UInt8(ascii: "M"):
            i += 1
            guard let v = digits(4), i == s.count else { return nil }
            altitude = Int((Double(v) * 10 * 3.28084).rounded()) // tens of metres
        default:
            guard rest == "VFR" else { return nil }
        }
        self.init(raw: string.uppercased(), speedKnots: knots, mach: mach, altitudeFt: altitude)
    }
}

/// A token of a filed route string.
public enum RouteToken: Codable, Sendable, Hashable {
    case waypoint(String)
    case airway(String)
    case direct
    case sid(String)
    case star(String)
    case coordinate(GeoPoint)
    case speedLevel(SpeedLevel)

    public var ident: String? {
        switch self {
        case .waypoint(let s), .airway(let s), .sid(let s), .star(let s): s
        case .coordinate(let p): RouteParser.format(p)
        case .direct, .speedLevel: nil
        }
    }
}

/// Tokeniser for ICAO / FAA route strings as filed on VATSIM.
///
/// Recognised:
/// - airways `[A-Z]{1,2}\d{1,4}[A-Z]?` (UM728, L9, Q35, T161, J80, N871, UL607, Y3);
/// - SID/STAR procedures `[A-Z]{2,6}\d[A-Z]?` (RAVAL1A, CAMRN4) at the first/last position;
/// - coordinates `4530N01015E`, `45N010E`, `453015N0101530E`, `N4530W07315`, `N45W073`, split pairs
///   `4530N 01015E`, and ARINC-424 NAT shorthand (`5020N` = 50N 020W, `50N20` = 50N 120W, `5020E`,
///   `5020W`, `5020S` for the other quadrants);
/// - speed/level groups, standalone (`N0450F350`) or suffixed (`RAVAL/N0450F350`, suffix stripped);
/// - `DCT` → `.direct`; `IFR`, `VFR`, `SID`, `STAR`, `T` (truncation) and runway suffixes (`LIRF/16L`) ignored.
/// FAA dotted notation (`KJFK.DEEZZ5.CANDR`) is split on dots.
public enum RouteParser {
    static let ignored: Set<String> = ["IFR", "VFR", "SID", "STAR", "T", "OFFBLK", "OAT", "RTE"]

    public static func parse(_ route: String) -> [RouteToken] {
        let raw = route.uppercased()
            .replacingOccurrences(of: "..", with: " ")
            .split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "." || $0 == "+" || $0 == "," })
            .map(String.init)

        // First pass: expand "/" suffixes and classify simple tokens.
        enum Pre: Equatable { case text(String), speed(SpeedLevel), direct, coord(GeoPoint) }
        var pre: [Pre] = []
        var i = 0
        while i < raw.count {
            var token = raw[i]
            var suffix: SpeedLevel?
            if let slash = token.firstIndex(of: "/") {
                let right = String(token[token.index(after: slash)...])
                token = String(token[..<slash])
                suffix = SpeedLevel(right)
            }
            defer { i += 1 }
            if token.isEmpty {
                if let suffix { pre.append(.speed(suffix)) }
                continue
            }
            if token == "DCT" { pre.append(.direct); continue }
            if ignored.contains(token) { continue }
            if let sl = SpeedLevel(token) { pre.append(.speed(sl)); continue }
            // Split latitude/longitude pair "4530N 01015E".
            if let lat = parseLatitudeOnly(token), i + 1 < raw.count, let lon = parseLongitudeOnly(raw[i + 1]) {
                pre.append(.coord(GeoPoint(latitude: lat, longitude: lon)))
                i += 1
                if let suffix { pre.append(.speed(suffix)) }
                continue
            }
            if let p = parseCoordinate(token) {
                pre.append(.coord(p))
            } else if isPlausibleIdent(token) {
                pre.append(.text(token))
            }
            if let suffix { pre.append(.speed(suffix)) }
        }

        // Second pass: airways and SID/STAR placement.
        func isAirportLike(_ p: Pre) -> Bool {
            if case .text(let t) = p { return t.count == 4 && t.allSatisfy(\.isLetter) }
            return false
        }
        let significant = pre.indices.filter {
            switch pre[$0] {
            case .text, .coord: true
            default: false
            }
        }
        // The SID is the first significant token (after a leading departure ICAO); the STAR the last
        // (before a trailing arrival ICAO).
        var sidIndex = significant.first
        var starIndex = significant.last
        if significant.count > 1 {
            if isAirportLike(pre[significant[0]]) { sidIndex = significant[1] }
            if isAirportLike(pre[significant[significant.count - 1]]) { starIndex = significant[significant.count - 2] }
        }
        var result: [RouteToken] = []
        for (idx, item) in pre.enumerated() {
            switch item {
            case .speed(let s): result.append(.speedLevel(s))
            case .direct: result.append(.direct)
            case .coord(let p): result.append(.coordinate(p))
            case .text(let t):
                if isProcedure(t) && idx == sidIndex {
                    result.append(.sid(t))
                } else if isProcedure(t) && idx == starIndex {
                    result.append(.star(t))
                } else if isAirway(t) {
                    result.append(.airway(t))
                } else {
                    result.append(.waypoint(t))
                }
            }
        }
        return result
    }

    /// `[A-Z]{1,2}\d{1,4}[A-Z]?`
    public static func isAirway(_ s: String) -> Bool {
        let c = Array(s.utf8)
        var i = 0
        var letters = 0
        while i < c.count, isLetter(c[i]) { letters += 1; i += 1 }
        guard (1...2).contains(letters) else { return false }
        var digits = 0
        while i < c.count, isDigit(c[i]) { digits += 1; i += 1 }
        guard (1...4).contains(digits) else { return false }
        if i < c.count, isLetter(c[i]) { i += 1 }
        return i == c.count
    }

    /// Letters + one digit + optional letter, e.g. RAVAL1A, CAMRN4, BIBA2W.
    public static func isProcedure(_ s: String) -> Bool {
        let c = Array(s.utf8)
        var i = 0
        var letters = 0
        while i < c.count, isLetter(c[i]) { letters += 1; i += 1 }
        guard (3...6).contains(letters), i < c.count, isDigit(c[i]) else { return false }
        i += 1
        if i < c.count, isLetter(c[i]) { i += 1 }
        return i == c.count
    }

    static func isPlausibleIdent(_ s: String) -> Bool {
        (1...12).contains(s.count) && s.utf8.allSatisfy { isLetter($0) || isDigit($0) || $0 == UInt8(ascii: "-") }
    }

    // MARK: Coordinates

    /// Parses any single-token coordinate format. Returns `nil` for other tokens.
    public static func parseCoordinate(_ token: String) -> GeoPoint? {
        let s = Array(token.uppercased().utf8)
        guard s.count >= 5 else { return nil }
        // ICAO "DD[MM[SS]]N DDD[MM[SS]]E"
        if isDigit(s[0]), let p = parseICAO(s) { return p }
        // "N4530W07315", "N45W073"
        if s[0] == UInt8(ascii: "N") || s[0] == UInt8(ascii: "S"), let p = parsePrefixed(s) { return p }
        // ARINC-424 shorthand "5020N", "50N20".
        if s.count == 5, let p = parseARINC(s) { return p }
        return nil
    }

    private static func parseICAO(_ s: [UInt8]) -> GeoPoint? {
        guard let hemiLat = s.firstIndex(where: { $0 == UInt8(ascii: "N") || $0 == UInt8(ascii: "S") }) else { return nil }
        let latDigits = Array(s[..<hemiLat]), rest = Array(s[(hemiLat + 1)...])
        guard let hemiLon = rest.firstIndex(where: { $0 == UInt8(ascii: "E") || $0 == UInt8(ascii: "W") }),
              hemiLon == rest.count - 1
        else { return nil }
        let lonDigits = Array(rest[..<hemiLon])
        guard let lat = dms(latDigits, degreeDigits: 2), let lon = dms(lonDigits, degreeDigits: 3),
              lat <= 90, lon <= 180
        else { return nil }
        return GeoPoint(latitude: s[hemiLat] == UInt8(ascii: "S") ? -lat : lat,
                        longitude: rest[hemiLon] == UInt8(ascii: "W") ? -lon : lon)
    }

    private static func parsePrefixed(_ s: [UInt8]) -> GeoPoint? {
        guard let hemiLon = s.indices.dropFirst().first(where: { s[$0] == UInt8(ascii: "E") || s[$0] == UInt8(ascii: "W") })
        else { return nil }
        let latDigits = Array(s[1..<hemiLon]), lonDigits = Array(s[(hemiLon + 1)...])
        guard let lat = dms(latDigits, degreeDigits: 2), let lon = dms(lonDigits, degreeDigits: 3),
              lat <= 90, lon <= 180
        else { return nil }
        return GeoPoint(latitude: s[0] == UInt8(ascii: "S") ? -lat : lat,
                        longitude: s[hemiLon] == UInt8(ascii: "W") ? -lon : lon)
    }

    /// ARINC 424 oceanic shorthand: position of the letter gives longitude ≥ 100 (letter in the middle).
    /// N = north/west, E = north/east, S = south/east, W = south/west.
    private static func parseARINC(_ s: [UInt8]) -> GeoPoint? {
        let letters: Set<UInt8> = [UInt8(ascii: "N"), UInt8(ascii: "E"), UInt8(ascii: "S"), UInt8(ascii: "W")]
        let latD: Int, lonD: Int, letter: UInt8
        if letters.contains(s[4]), s[0..<4].allSatisfy(isDigit) {
            latD = Int(s[0] - 48) * 10 + Int(s[1] - 48)
            lonD = Int(s[2] - 48) * 10 + Int(s[3] - 48)
            letter = s[4]
        } else if letters.contains(s[2]), isDigit(s[0]), isDigit(s[1]), isDigit(s[3]), isDigit(s[4]) {
            latD = Int(s[0] - 48) * 10 + Int(s[1] - 48)
            lonD = 100 + Int(s[3] - 48) * 10 + Int(s[4] - 48)
            letter = s[2]
        } else {
            return nil
        }
        guard latD <= 90, lonD <= 180 else { return nil }
        let lat = Double(latD), lon = Double(lonD)
        switch letter {
        case UInt8(ascii: "N"): return GeoPoint(latitude: lat, longitude: -lon)
        case UInt8(ascii: "E"): return GeoPoint(latitude: lat, longitude: lon)
        case UInt8(ascii: "S"): return GeoPoint(latitude: -lat, longitude: lon)
        default: return GeoPoint(latitude: -lat, longitude: -lon)
        }
    }

    /// "4530N" alone (first half of a split pair).
    static func parseLatitudeOnly(_ token: String) -> Double? {
        let s = Array(token.utf8)
        guard s.count == 3 || s.count == 5 || s.count == 7, let last = s.last,
              last == UInt8(ascii: "N") || last == UInt8(ascii: "S"),
              let v = dms(Array(s.dropLast()), degreeDigits: 2), v <= 90
        else { return nil }
        return last == UInt8(ascii: "S") ? -v : v
    }

    /// "01015E" alone (second half of a split pair).
    static func parseLongitudeOnly(_ token: String) -> Double? {
        let s = Array(token.utf8)
        guard s.count == 4 || s.count == 6 || s.count == 8, let last = s.last,
              last == UInt8(ascii: "E") || last == UInt8(ascii: "W"),
              let v = dms(Array(s.dropLast()), degreeDigits: 3), v <= 180
        else { return nil }
        return last == UInt8(ascii: "W") ? -v : v
    }

    /// Degrees with optional minutes and seconds: D…D[MM[SS]].
    private static func dms(_ digits: [UInt8], degreeDigits: Int) -> Double? {
        guard digits.allSatisfy(isDigit) else { return nil }
        let n = digits.count
        guard n == degreeDigits || n == degreeDigits + 2 || n == degreeDigits + 4 else { return nil }
        func value(_ r: Range<Int>) -> Int { digits[r].reduce(0) { $0 * 10 + Int($1 - 48) } }
        var v = Double(value(0..<degreeDigits))
        if n >= degreeDigits + 2 {
            let m = value(degreeDigits..<(degreeDigits + 2))
            guard m < 60 else { return nil }
            v += Double(m) / 60
        }
        if n == degreeDigits + 4 {
            let sec = value((degreeDigits + 2)..<(degreeDigits + 4))
            guard sec < 60 else { return nil }
            v += Double(sec) / 3600
        }
        return v
    }

    /// Formats a coordinate as an ICAO ident ("4530N01015E", or "45N010E" for whole degrees).
    public static func format(_ p: GeoPoint) -> String {
        func pad(_ v: Int, _ n: Int) -> String {
            let s = String(v)
            return String(repeating: "0", count: max(0, n - s.count)) + s
        }
        let latTotal = Int((abs(p.latitude) * 60).rounded())
        let lonTotal = Int((abs(p.longitude) * 60).rounded())
        let ns = p.latitude < 0 ? "S" : "N", ew = p.longitude < 0 ? "W" : "E"
        if latTotal % 60 == 0 && lonTotal % 60 == 0 {
            return "\(pad(latTotal / 60, 2))\(ns)\(pad(lonTotal / 60, 3))\(ew)"
        }
        return "\(pad(latTotal / 60, 2))\(pad(latTotal % 60, 2))\(ns)\(pad(lonTotal / 60, 3))\(pad(lonTotal % 60, 2))\(ew)"
    }

    @inline(__always) static func isDigit(_ c: UInt8) -> Bool { c >= 0x30 && c <= 0x39 }
    @inline(__always) static func isLetter(_ c: UInt8) -> Bool { c >= 0x41 && c <= 0x5A }
}
