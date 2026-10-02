import Foundation

/// Curated list of European capitals and the airports that serve them ("Capitali europee" challenge).
public enum EuropeanCapitals {
    public struct Capital: Codable, Sendable, Hashable, Identifiable {
        public var city: String
        /// ISO 3166-1 alpha-2 (XK for Kosovo).
        public var country: String
        public var icaos: [String]
        public var id: String { country }
    }

    public static let all: [Capital] = [
        Capital(city: "Rome", country: "IT", icaos: ["LIRF", "LIRA"]),
        Capital(city: "Paris", country: "FR", icaos: ["LFPG", "LFPO"]),
        Capital(city: "London", country: "GB", icaos: ["EGLL", "EGKK", "EGSS", "EGLC", "EGGW"]),
        Capital(city: "Berlin", country: "DE", icaos: ["EDDB"]),
        Capital(city: "Madrid", country: "ES", icaos: ["LEMD"]),
        Capital(city: "Lisbon", country: "PT", icaos: ["LPPT"]),
        Capital(city: "Amsterdam", country: "NL", icaos: ["EHAM"]),
        Capital(city: "Brussels", country: "BE", icaos: ["EBBR"]),
        Capital(city: "Luxembourg", country: "LU", icaos: ["ELLX"]),
        Capital(city: "Bern", country: "CH", icaos: ["LSZB"]),
        Capital(city: "Vienna", country: "AT", icaos: ["LOWW"]),
        Capital(city: "Prague", country: "CZ", icaos: ["LKPR"]),
        Capital(city: "Warsaw", country: "PL", icaos: ["EPWA"]),
        Capital(city: "Budapest", country: "HU", icaos: ["LHBP"]),
        Capital(city: "Bratislava", country: "SK", icaos: ["LZIB"]),
        Capital(city: "Ljubljana", country: "SI", icaos: ["LJLJ"]),
        Capital(city: "Zagreb", country: "HR", icaos: ["LDZA"]),
        Capital(city: "Sarajevo", country: "BA", icaos: ["LQSA"]),
        Capital(city: "Belgrade", country: "RS", icaos: ["LYBE"]),
        Capital(city: "Podgorica", country: "ME", icaos: ["LYPG"]),
        Capital(city: "Pristina", country: "XK", icaos: ["BKPR"]),
        Capital(city: "Skopje", country: "MK", icaos: ["LWSK"]),
        Capital(city: "Tirana", country: "AL", icaos: ["LATI"]),
        Capital(city: "Athens", country: "GR", icaos: ["LGAV"]),
        Capital(city: "Sofia", country: "BG", icaos: ["LBSF"]),
        Capital(city: "Bucharest", country: "RO", icaos: ["LROP", "LRBS"]),
        Capital(city: "Chișinău", country: "MD", icaos: ["LUKK"]),
        Capital(city: "Kyiv", country: "UA", icaos: ["UKBB", "UKKK"]),
        Capital(city: "Vilnius", country: "LT", icaos: ["EYVI"]),
        Capital(city: "Riga", country: "LV", icaos: ["EVRA"]),
        Capital(city: "Tallinn", country: "EE", icaos: ["EETN"]),
        Capital(city: "Helsinki", country: "FI", icaos: ["EFHK"]),
        Capital(city: "Stockholm", country: "SE", icaos: ["ESSA", "ESSB"]),
        Capital(city: "Oslo", country: "NO", icaos: ["ENGM"]),
        Capital(city: "Copenhagen", country: "DK", icaos: ["EKCH"]),
        Capital(city: "Reykjavík", country: "IS", icaos: ["BIRK", "BIKF"]),
        Capital(city: "Dublin", country: "IE", icaos: ["EIDW"]),
        Capital(city: "Valletta", country: "MT", icaos: ["LMML"]),
        Capital(city: "Nicosia", country: "CY", icaos: ["LCLK"]),
        Capital(city: "Minsk", country: "BY", icaos: ["UMMS"]),
        Capital(city: "Moscow", country: "RU", icaos: ["UUEE", "UUDD", "UUWW"]),
        Capital(city: "Ankara", country: "TR", icaos: ["LTAC"]),
    ]

    static let byICAO: [String: Capital] = {
        var map: [String: Capital] = [:]
        for c in all { for icao in c.icaos { map[icao] = c } }
        return map
    }()

    public static func capital(forICAO icao: String) -> Capital? { byICAO[icao.uppercased()] }
}

/// Aircraft type groupings (ICAO type designators).
public enum AircraftCategories {
    public static let widebody: Set<String> = [
        "A306", "A30B", "A310", "A332", "A333", "A337", "A338", "A339", "A342", "A343", "A345", "A346",
        "A359", "A35K", "A388", "B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "B762", "B763",
        "B764", "B772", "B773", "B77L", "B77W", "B778", "B779", "B788", "B789", "B78X", "DC10", "MD11",
        "L101", "IL86", "IL96", "A3ST", "BLCF", "C5M", "A124", "A225",
    ]

    public static let turboprop: Set<String> = [
        "AT43", "AT44", "AT45", "AT46", "AT72", "AT73", "AT75", "AT76", "DH8A", "DH8B", "DH8C", "DH8D",
        "SF34", "SB20", "JS31", "JS32", "JS41", "D328", "F50", "E120", "B190", "BE20", "BE9L", "BE30",
        "B350", "PC12", "PC6T", "C208", "DHC6", "DHC7", "L410", "AN24", "AN26", "MA60", "Q400", "C130",
        "C30J", "A400", "P180", "TBM7", "TBM8", "TBM9", "KODI", "ATP", "SW4",
    ]

    /// Normalises "A320/M", "H/B744/L" and lower-case input to the bare designator.
    public static func designator(_ type: String) -> String {
        let parts = type.uppercased().split(separator: "/").map(String.init)
        if parts.count >= 2, parts[0].count == 1 { return parts[1] } // wake prefix "H/B744"
        return parts.first ?? ""
    }

    public static func isWidebody(_ type: String) -> Bool { widebody.contains(designator(type)) }
    public static func isTurboprop(_ type: String) -> Bool { turboprop.contains(designator(type)) }
}

/// Continental heuristics for badge rules.
public enum WorldRegion: String, Codable, Sendable, Hashable {
    case americas, europeAfrica, other

    /// Longitude-based: Americas = (-170°, -30°), Europe/Africa = [-30°, 60°). Iceland and the Azores fall
    /// on the European side, Greenland on the American side.
    public static func of(_ p: GeoPoint) -> WorldRegion {
        let lon = GeoPoint.normalizeLongitude(p.longitude)
        if lon > -170 && lon < -30 { return .americas }
        if lon >= -30 && lon < 60 { return .europeAfrica }
        return .other
    }
}
