import Foundation

/// A `[Countries]` entry of VATSpy.dat.
public struct VATSpyCountry: Codable, Sendable, Hashable {
    public var name: String
    /// ICAO prefix (1–2 letters) of the country's airports and FIRs ("LI", "K").
    public var icaoPrefix: String
    /// Word used for area control in this country ("Control", "Radar", "Center"), may be empty.
    public var centerSuffixName: String

    public init(name: String, icaoPrefix: String, centerSuffixName: String = "") {
        self.name = name
        self.icaoPrefix = icaoPrefix
        self.centerSuffixName = centerSuffixName
    }
}

/// A `[FIRs]` entry: `ICAO|Name|Callsign prefix|Boundary ID`.
public struct FIREntry: Codable, Sendable, Hashable {
    /// FIR identifier ("LIRR", "EDGG-N").
    public var icao: String
    public var name: String
    /// Callsign prefix used by controllers ("EDGG_N", "LON"); empty means the ICAO is used.
    public var callsignPrefix: String
    /// `id` of the matching feature in the FIR boundaries GeoJSON.
    public var boundaryID: String

    public init(icao: String, name: String, callsignPrefix: String = "", boundaryID: String = "") {
        self.icao = icao
        self.name = name
        self.callsignPrefix = callsignPrefix
        self.boundaryID = boundaryID.isEmpty ? icao : boundaryID
    }

    /// The prefix a controller logs in with (`callsignPrefix`, or the ICAO when empty).
    public var effectivePrefix: String { callsignPrefix.isEmpty ? icao : callsignPrefix }
}

/// A `[UIRs]` entry: `ID|Name|FIR1,FIR2,…`.
public struct UIREntry: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    /// FIR identifiers (matching ``FIREntry/icao``).
    public var firIDs: [String]

    public init(id: String, name: String, firIDs: [String]) {
        self.id = id
        self.name = name
        self.firIDs = firIDs
    }
}

/// Parsed VATSpy.dat.
public struct VATSpyData: Sendable {
    public var countries: [VATSpyCountry]
    /// Includes pseudo airports (``Airport/isPseudo``), which are alternative callsign prefixes.
    public var airports: [Airport]
    public var firs: [FIREntry]
    public var uirs: [UIREntry]
    /// International date line polyline.
    public var idl: [GeoPoint]

    public init(countries: [VATSpyCountry] = [], airports: [Airport] = [], firs: [FIREntry] = [],
                uirs: [UIREntry] = [], idl: [GeoPoint] = []) {
        self.countries = countries
        self.airports = airports
        self.firs = firs
        self.uirs = uirs
        self.idl = idl
    }

    /// Country for an ICAO code (tries the 2-letter then the 1-letter prefix).
    public func country(forICAO icao: String) -> VATSpyCountry? {
        let upper = icao.uppercased()
        let index = Dictionary(countries.map { ($0.icaoPrefix, $0) }, uniquingKeysWith: { a, _ in a })
        if upper.count >= 2, let c = index[String(upper.prefix(2))] { return c }
        if let first = upper.first { return index[String(first)] }
        return nil
    }
}

/// Parser for the VATSpy data project's `VATSpy.dat`.
public enum VATSpyParser {
    /// Parses the file. Comment lines (`;`), blank lines, CRLF, unknown sections and lines with
    /// missing/extra columns are tolerated; unusable lines are skipped.
    public static func parse(_ text: String) -> VATSpyData {
        var data = VATSpyData()
        var section = ""
        data.airports.reserveCapacity(20_000)
        for rawLine in text.utf8.split(separator: 0x0A, omittingEmptySubsequences: true) {
            var line = Substring(rawLine)
            if line.hasSuffix("\r") { line = line.dropLast() }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, !trimmed.hasPrefix(";") else { continue }
            if trimmed.hasPrefix("["), trimmed.hasSuffix("]") {
                section = trimmed.dropFirst().dropLast().lowercased()
                continue
            }
            let fields = trimmed.split(separator: "|", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            func field(_ i: Int) -> String { i < fields.count ? fields[i] : "" }
            switch section {
            case "countries":
                guard !field(0).isEmpty, !field(1).isEmpty else { continue }
                data.countries.append(VATSpyCountry(name: field(0), icaoPrefix: field(1).uppercased(), centerSuffixName: field(2)))
            case "airports":
                let icao = field(0).uppercased()
                guard !icao.isEmpty, let lat = Double(field(2)), let lon = Double(field(3)),
                      (-90...90).contains(lat), (-180...180).contains(lon) else { continue }
                data.airports.append(Airport(icao: icao, name: field(1), latitude: lat, longitude: lon,
                                             iata: field(4).uppercased(), fir: field(5).uppercased(),
                                             isPseudo: field(6) == "1"))
            case "firs":
                let icao = field(0).uppercased()
                guard !icao.isEmpty else { continue }
                data.firs.append(FIREntry(icao: icao, name: field(1), callsignPrefix: field(2).uppercased(),
                                          boundaryID: field(3).uppercased()))
            case "uirs":
                let id = field(0).uppercased()
                guard !id.isEmpty else { continue }
                let firs = field(2).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
                    .filter { !$0.isEmpty }
                data.uirs.append(UIREntry(id: id, name: field(1), firIDs: firs))
            case "idl":
                guard let lat = Double(field(0)), let lon = Double(field(1)) else { continue }
                data.idl.append(GeoPoint(latitude: lat, longitude: lon))
            default:
                continue
            }
        }
        return data
    }

    /// Parses a file on disk (UTF-8; invalid sequences are replaced).
    public static func parse(contentsOf url: URL) throws -> VATSpyData {
        let data = try Data(contentsOf: url)
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        return parse(text)
    }
}
