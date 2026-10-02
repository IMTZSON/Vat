import Foundation

/// Minimal RFC 4180 CSV line splitter (quoted fields, doubled quotes).
enum CSVLineParser {
    static func fields(_ line: Substring) -> [String] {
        guard line.contains("\"") else { return line.split(separator: ",", omittingEmptySubsequences: false).map(String.init) }
        var fields: [String] = []
        var current = ""
        var inQuotes = false
        var iterator = line.makeIterator()
        var pending: Character? = nil
        while let ch = pending ?? iterator.next() {
            pending = nil
            if inQuotes {
                if ch == "\"" {
                    if let next = iterator.next() {
                        if next == "\"" { current.append("\"") } else { inQuotes = false; pending = next }
                    } else {
                        inQuotes = false
                    }
                } else {
                    current.append(ch)
                }
            } else if ch == "\"" {
                inQuotes = true
            } else if ch == "," {
                fields.append(current)
                current = ""
            } else {
                current.append(ch)
            }
        }
        fields.append(current)
        return fields
    }

    /// Splits text into non-empty lines (LF or CRLF).
    static func lines(_ text: String) -> [Substring] {
        text.split(whereSeparator: { $0 == "\n" || $0 == "\r\n" || $0 == "\r" })
    }
}

/// Uniform lat/lon bucket grid for nearest/in-bounds queries.
struct GeoGridIndex: Sendable {
    let cellDegrees: Double
    private(set) var cells: [Int: [Int]] = [:]

    init(cellDegrees: Double) { self.cellDegrees = cellDegrees }

    var columns: Int { Int((360 / cellDegrees).rounded(.up)) }
    var rows: Int { Int((180 / cellDegrees).rounded(.up)) }

    func row(_ lat: Double) -> Int { min(rows - 1, max(0, Int(((lat + 90) / cellDegrees).rounded(.down)))) }
    func column(_ lon: Double) -> Int {
        let c = Int(((GeoPoint.normalizeLongitude(lon) + 180) / cellDegrees).rounded(.down))
        return ((c % columns) + columns) % columns
    }
    func key(row: Int, column: Int) -> Int { row * columns + column }

    mutating func insert(_ index: Int, at point: GeoPoint) {
        cells[key(row: row(point.latitude), column: column(point.longitude)), default: []].append(index)
    }

    /// Inserts `index` into every cell overlapping `bounds`.
    mutating func insert(_ index: Int, bounds: GeoBounds) {
        for key in keys(in: bounds) { cells[key, default: []].append(index) }
    }

    func keys(in bounds: GeoBounds) -> [Int] {
        let r0 = row(bounds.minLat), r1 = row(bounds.maxLat)
        var columnsList: [Int] = []
        let c0 = column(bounds.minLon), c1 = column(bounds.maxLon)
        if bounds.crossesAntimeridian || c1 < c0 {
            columnsList = Array(c0..<columns) + Array(0...c1)
        } else {
            columnsList = Array(c0...c1)
        }
        var result: [Int] = []
        result.reserveCapacity((r1 - r0 + 1) * columnsList.count)
        for r in r0...r1 { for c in columnsList { result.append(key(row: r, column: c)) } }
        return result
    }

    func candidates(at point: GeoPoint) -> [Int] {
        cells[key(row: row(point.latitude), column: column(point.longitude))] ?? []
    }

    func candidates(in bounds: GeoBounds) -> [Int] {
        keys(in: bounds).flatMap { cells[$0] ?? [] }
    }
}

/// Immutable airport catalogue built from VATSpy (+ OurAirports extras): lookup by ICAO, IATA/LID,
/// text search and nearest-airport queries.
public final class AirportDatabase: WaypointLookup, Sendable {
    /// Real airports (pseudo entries excluded), in VATSpy order.
    public let airports: [Airport]
    private let byICAO: [String: Int]
    private let pseudoByICAO: [String: Airport]
    private let byAlias: [String: Airport]
    private let foldedNames: [String]
    private let sizeRank: [Int]
    private let grid: GeoGridIndex

    /// - Parameters:
    ///   - airports: VATSpy airports, pseudo entries included (used for callsign aliases).
    ///   - extrasCSV: Optional `icao,elevation_ft,iso_country,municipality,scheduled(0/1),type` text.
    public init(airports input: [Airport], extrasCSV: String? = nil) {
        var extras: [String: (elevation: Int?, country: String, city: String, scheduled: Bool, type: String)] = [:]
        if let extrasCSV {
            for line in CSVLineParser.lines(extrasCSV) {
                let f = CSVLineParser.fields(line)
                guard f.count >= 2 else { continue }
                let icao = f[0].trimmingCharacters(in: .whitespaces).uppercased()
                guard !icao.isEmpty, icao != "ICAO" else { continue }
                extras[icao] = (Int(f[1].trimmingCharacters(in: .whitespaces)),
                                f.count > 2 ? f[2] : "", f.count > 3 ? f[3] : "",
                                f.count > 4 ? f[4].trimmingCharacters(in: .whitespaces) == "1" : false,
                                f.count > 5 ? f[5].trimmingCharacters(in: .whitespaces) : "")
            }
        }
        var real: [Airport] = []
        var ranks: [Int] = []
        var icaoIndex: [String: Int] = [:]
        var pseudo: [String: Airport] = [:]
        real.reserveCapacity(input.count)
        for var airport in input {
            if let extra = extras[airport.icao] {
                if let elevation = extra.elevation { airport.elevationFt = elevation }
                if !extra.country.isEmpty { airport.country = extra.country }
                if !extra.city.isEmpty { airport.city = extra.city }
                airport.hasScheduledService = extra.scheduled
            }
            if airport.isPseudo {
                if pseudo[airport.icao] == nil { pseudo[airport.icao] = airport }
                continue
            }
            guard icaoIndex[airport.icao] == nil else { continue }
            icaoIndex[airport.icao] = real.count
            real.append(airport)
            let type = extras[airport.icao]?.type ?? ""
            ranks.append(type == "large_airport" ? 3 : type == "medium_airport" ? 2 : type == "small_airport" ? 1 : 0)
        }
        // IATA/LID aliases: real airports first, then pseudo entries (e.g. "SOLENT").
        var aliases: [String: Airport] = [:]
        for airport in real where !airport.iata.isEmpty && aliases[airport.iata] == nil {
            aliases[airport.iata] = airport
        }
        for airport in input where airport.isPseudo && !airport.iata.isEmpty && aliases[airport.iata] == nil {
            let target = icaoIndex[airport.icao].map { real[$0] }
            aliases[airport.iata] = target ?? pseudo[airport.icao] ?? airport
        }
        var grid = GeoGridIndex(cellDegrees: 1)
        for (i, airport) in real.enumerated() { grid.insert(i, at: airport.position) }

        airports = real
        byICAO = icaoIndex
        pseudoByICAO = pseudo
        byAlias = aliases
        sizeRank = ranks
        foldedNames = real.map { Self.fold($0.name + " " + $0.city) }
        self.grid = grid
    }

    /// Convenience: parse VATSpy text and optional extras.
    public convenience init(vatspy: VATSpyData, extrasCSV: String? = nil) {
        self.init(airports: vatspy.airports, extrasCSV: extrasCSV)
    }

    public var count: Int { airports.count }

    /// Real airport by ICAO; falls back to a VATSpy pseudo airport with that code.
    public func airport(icao: String) -> Airport? {
        let key = icao.uppercased()
        if let index = byICAO[key] { return airports[index] }
        return pseudoByICAO[key]
    }

    /// Airport by IATA code or FAA LID / VATSpy alias ("JFK" → KJFK, "ATL" → KATL).
    public func airport(iataOrLID code: String) -> Airport? {
        byAlias[code.uppercased()]
    }

    /// Resolves a callsign prefix: ICAO first, then IATA/LID alias.
    public func airport(callsignPrefix prefix: String) -> Airport? {
        airport(icao: prefix) ?? airport(iataOrLID: prefix)
    }

    /// Searches by ICAO prefix, exact IATA, or name/city substring (case and diacritic insensitive).
    /// Results: exact ICAO, exact IATA, ICAO prefix, then name matches; larger airports first.
    public func search(_ query: String, limit: Int = 20) -> [Airport] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, limit > 0 else { return [] }
        let upper = q.uppercased()
        let folded = Self.fold(q)
        var seen = Set<Int>()
        var tiers: [[Int]] = [[], [], [], []]
        if let exact = byICAO[upper] { tiers[0].append(exact) }
        if let alias = byAlias[upper], let index = byICAO[alias.icao] { tiers[1].append(index) }
        let isCode = upper.count <= 4 && upper.allSatisfy { $0.isLetter || $0.isNumber }
        for i in airports.indices {
            if isCode, airports[i].icao.hasPrefix(upper) { tiers[2].append(i) }
            else if folded.count >= 2, foldedNames[i].contains(folded) { tiers[3].append(i) }
        }
        var result: [Airport] = []
        for tier in tiers {
            for i in tier.sorted(by: { (sizeRank[$0], -$0) > (sizeRank[$1], -$1) }) where !seen.contains(i) {
                seen.insert(i)
                result.append(airports[i])
                if result.count >= limit { return result }
            }
        }
        return result
    }

    /// Nearest real airport within `maxDistanceNM` (default 50 NM).
    public func nearest(to point: GeoPoint, maxDistanceNM: Double = 50) -> Airport? {
        airports(near: point, withinNM: maxDistanceNM).first
    }

    /// Airports within `radiusNM`, nearest first.
    public func airports(near point: GeoPoint, withinNM radiusNM: Double) -> [Airport] {
        let dLat = radiusNM / 60
        let dLon = min(180, radiusNM / max(0.5, 60 * cos(point.latitude * .pi / 180)))
        let bounds = GeoBounds(minLat: max(-90, point.latitude - dLat), maxLat: min(90, point.latitude + dLat),
                               minLon: dLon >= 180 ? -180 : GeoPoint.normalizeLongitude(point.longitude - dLon),
                               maxLon: dLon >= 180 ? 180 : GeoPoint.normalizeLongitude(point.longitude + dLon))
        return grid.candidates(in: bounds)
            .map { (airport: airports[$0], distance: airports[$0].position.distance(to: point)) }
            .filter { $0.distance <= radiusNM }
            .sorted { $0.distance < $1.distance }
            .map(\.airport)
    }

    /// Airports inside a bounding box (e.g. the visible map region).
    public func airports(in bounds: GeoBounds) -> [Airport] {
        grid.candidates(in: bounds).map { airports[$0] }.filter { bounds.contains($0.position) }
    }

    // MARK: WaypointLookup

    public func candidates(for ident: String) -> [Waypoint] {
        guard let index = byICAO[ident.uppercased()] else { return [] }
        let airport = airports[index]
        return [Waypoint(ident: airport.icao, name: airport.name, kind: .airport, point: airport.position)]
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
    }
}

/// Immutable navaid catalogue from `navaids.csv` (`ident,name,type,lat,lon,freq_khz,country`).
public final class NavaidDatabase: WaypointLookup, Sendable {
    public let navaids: [Navaid]
    private let byIdent: [String: [Int]]

    public init(navaids: [Navaid]) {
        self.navaids = navaids
        var index: [String: [Int]] = [:]
        for (i, navaid) in navaids.enumerated() { index[navaid.ident, default: []].append(i) }
        byIdent = index
    }

    /// Parses the CSV (quoted fields allowed, header line optional, bad lines skipped).
    public convenience init(csv: String) {
        var list: [Navaid] = []
        for line in CSVLineParser.lines(csv) {
            let f = CSVLineParser.fields(line)
            guard f.count >= 5, let lat = Double(f[3].trimmingCharacters(in: .whitespaces)),
                  let lon = Double(f[4].trimmingCharacters(in: .whitespaces)),
                  (-90...90).contains(lat), (-180...180).contains(lon) else { continue }
            let ident = f[0].trimmingCharacters(in: .whitespaces).uppercased()
            guard !ident.isEmpty else { continue }
            list.append(Navaid(ident: ident, name: f[1], type: f[2].trimmingCharacters(in: .whitespaces).uppercased(),
                               latitude: lat, longitude: lon,
                               frequencyKHz: f.count > 5 ? Int(f[5].trimmingCharacters(in: .whitespaces)) : nil,
                               country: f.count > 6 ? f[6].trimmingCharacters(in: .whitespaces) : ""))
        }
        self.init(navaids: list)
    }

    public var count: Int { navaids.count }

    /// All navaids with this identifier (identifiers are not unique worldwide).
    public func navaids(ident: String) -> [Navaid] {
        (byIdent[ident.uppercased()] ?? []).map { navaids[$0] }
    }

    /// Navaid with this identifier closest to `point`.
    public func navaid(ident: String, near point: GeoPoint) -> Navaid? {
        navaids(ident: ident).min { $0.position.distance(to: point) < $1.position.distance(to: point) }
    }

    public func candidates(for ident: String) -> [Waypoint] {
        navaids(ident: ident).map { Waypoint(ident: $0.ident, name: $0.name, kind: .navaid, point: $0.position) }
    }
}

/// Fixed list of waypoints (e.g. a SimBrief navlog) usable as a ``WaypointLookup``.
public struct StaticWaypointLookup: WaypointLookup, Sendable {
    private let byIdent: [String: [Waypoint]]

    public init(waypoints: [Waypoint]) {
        var index: [String: [Waypoint]] = [:]
        for waypoint in waypoints {
            let key = waypoint.ident.uppercased()
            if !(index[key]?.contains(where: { $0.point == waypoint.point }) ?? false) { index[key, default: []].append(waypoint) }
        }
        byIdent = index
    }

    public func candidates(for ident: String) -> [Waypoint] { byIdent[ident.uppercased()] ?? [] }
}

/// Queries several lookups in order and concatenates their candidates.
public struct CombinedWaypointLookup: WaypointLookup, Sendable {
    public let lookups: [any WaypointLookup]

    public init(_ lookups: [any WaypointLookup]) {
        self.lookups = lookups
    }

    public func candidates(for ident: String) -> [Waypoint] {
        lookups.flatMap { $0.candidates(for: ident) }
    }
}
