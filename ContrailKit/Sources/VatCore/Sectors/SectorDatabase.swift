import Foundation

/// Static catalogue of airspace volumes (FIR, UIR, TRACON) and the VATSpy-style rules mapping a
/// controller callsign to the volume(s) it staffs. Immutable and thread-safe; build it once at launch
/// (off the main thread) and share it.
public final class SectorDatabase: Sendable {
    /// Radii of airport-centred circles (DECISIONS D-013).
    public enum Radius {
        public static let approach: Double = 40
        public static let tower: Double = 12
        public static let ground: Double = 6
        public static let delivery: Double = 3
        public static let atis: Double = 0
    }

    public let vatspy: VATSpyData
    public let airports: AirportDatabase
    public let firBoundaries: [FIRBoundary]
    public let traconBoundaries: [TRACONBoundary]
    /// FIR, UIR and TRACON volumes (airport circles are created on demand by ``volumes(for:)``).
    public let volumes: [AirspaceVolume]

    private let volumeIndexByID: [String: Int]
    /// Callsign prefix → FIR volume indices (several when a boundary has oceanic + domestic parts).
    private let firByPrefix: [String: [Int]]
    /// FIR ICAO ("EDGG-N") → FIR volume indices.
    private let firByICAO: [String: [Int]]
    private let uirByID: [String: Int]
    /// TRACON prefix → indices into `traconBoundaries` (and `traconVolume`).
    private let traconByPrefix: [String: [Int]]
    private let traconVolume: [Int]
    private let volumeGrid: GeoGridIndex
    private let firBoundaryGrid: GeoGridIndex
    private let countrySuffix: [String: String]

    public init(vatspy: VATSpyData, firBoundaries: [FIRBoundary], traconBoundaries: [TRACONBoundary],
                airports: AirportDatabase? = nil) {
        self.vatspy = vatspy
        self.airports = airports ?? AirportDatabase(airports: vatspy.airports)
        self.firBoundaries = firBoundaries
        self.traconBoundaries = traconBoundaries

        var suffixes: [String: String] = [:]
        for country in vatspy.countries where suffixes[country.icaoPrefix] == nil {
            suffixes[country.icaoPrefix] = country.centerSuffixName
        }
        countrySuffix = suffixes

        var volumes: [AirspaceVolume] = []
        var indexByID: [String: Int] = [:]
        func add(_ volume: AirspaceVolume) -> Int {
            var v = volume
            if indexByID[v.id] != nil {
                var n = 2
                while indexByID["\(volume.id)#\(n)"] != nil { n += 1 }
                v.id = "\(volume.id)#\(n)"
            }
            indexByID[v.id] = volumes.count
            volumes.append(v)
            return volumes.count - 1
        }

        // --- FIR volumes: one per (boundary id, oceanic flag).
        var featuresByID: [String: [FIRBoundary]] = [:]
        var boundaryOrder: [String] = []
        for boundary in firBoundaries {
            if featuresByID[boundary.id] == nil { boundaryOrder.append(boundary.id) }
            featuresByID[boundary.id, default: []].append(boundary)
        }
        var entriesByBoundary: [String: [FIREntry]] = [:]
        for entry in vatspy.firs { entriesByBoundary[entry.boundaryID, default: []].append(entry) }

        var volumesByBoundary: [String: [Int]] = [:]
        for id in boundaryOrder {
            guard let features = featuresByID[id] else { continue }
            let entries = entriesByBoundary[id] ?? []
            var prefixes: [String] = []
            for entry in entries where !prefixes.contains(entry.effectivePrefix) { prefixes.append(entry.effectivePrefix) }
            if prefixes.isEmpty { prefixes = [id] }
            let baseName = entries.first.map { Self.displayName($0.name, icao: $0.icao, suffixes: suffixes) } ?? id
            let groups = [false, true].map { flag in features.filter { $0.isOceanic == flag } }.filter { !$0.isEmpty }
            for group in groups {
                let oceanic = group[0].isOceanic
                let geometry = GeoMultiPolygon(polygons: group.flatMap(\.geometry.polygons))
                let suffix = oceanic && groups.count > 1 ? ":OCEANIC" : ""
                let index = add(AirspaceVolume(
                    id: "FIR:\(id)\(suffix)", kind: .fir,
                    name: oceanic && groups.count > 1 ? "\(baseName) (Oceanic)" : baseName,
                    callsignPrefixes: prefixes, geometry: geometry, center: group[0].labelPoint,
                    isOceanic: oceanic, region: group[0].region, division: group[0].division))
                volumesByBoundary[id, default: []].append(index)
            }
        }
        var byPrefix: [String: [Int]] = [:]
        var byICAO: [String: [Int]] = [:]
        for entry in vatspy.firs {
            guard let indices = volumesByBoundary[entry.boundaryID] else { continue }
            for i in indices {
                if !(byPrefix[entry.effectivePrefix]?.contains(i) ?? false) { byPrefix[entry.effectivePrefix, default: []].append(i) }
                if !(byICAO[entry.icao]?.contains(i) ?? false) { byICAO[entry.icao, default: []].append(i) }
            }
        }
        // Boundaries without a VATSpy entry are still reachable by their own id.
        for (id, indices) in volumesByBoundary where byICAO[id] == nil { byICAO[id] = indices }

        // --- UIR volumes: union of member FIRs.
        var uirs: [String: Int] = [:]
        for uir in vatspy.uirs {
            var polygons: [GeoPolygon] = []
            var seen = Set<Int>()
            for fir in uir.firIDs {
                for i in byICAO[fir] ?? volumesByBoundary[fir] ?? [] where !seen.contains(i) {
                    seen.insert(i)
                    polygons += volumes[i].geometry?.polygons ?? []
                }
            }
            guard !polygons.isEmpty else { continue }
            let geometry = GeoMultiPolygon(polygons: polygons)
            uirs[uir.id] = add(AirspaceVolume(id: "UIR:\(uir.id)", kind: .uir, name: uir.name, callsignPrefixes: [uir.id],
                                              geometry: geometry, center: geometry.bounds.center))
        }

        // --- TRACON volumes.
        var traconPrefix: [String: [Int]] = [:]
        var traconVolumes: [Int] = []
        let idCounts = Dictionary(traconBoundaries.map { ($0.id, 1) }, uniquingKeysWith: +)
        for (i, boundary) in traconBoundaries.enumerated() {
            for prefix in boundary.prefixes { traconPrefix[prefix, default: []].append(i) }
            var id = "TRACON:\(boundary.id)"
            if (idCounts[boundary.id] ?? 0) > 1 {
                id += "/" + boundary.prefixes.joined(separator: "+") + (boundary.suffix.map { "_" + $0 } ?? "")
            }
            traconVolumes.append(add(AirspaceVolume(
                id: id, kind: .tracon, name: boundary.name, callsignPrefixes: boundary.prefixes,
                callsignSuffix: boundary.suffix, geometry: boundary.geometry, center: boundary.labelPoint)))
        }

        // --- Spatial indexes (10° buckets).
        var grid = GeoGridIndex(cellDegrees: 10)
        for (i, volume) in volumes.enumerated() { grid.insert(i, bounds: volume.bounds) }
        var firGrid = GeoGridIndex(cellDegrees: 10)
        for (i, boundary) in firBoundaries.enumerated() { firGrid.insert(i, bounds: boundary.geometry.bounds) }

        self.volumes = volumes
        volumeIndexByID = indexByID
        firByPrefix = byPrefix
        firByICAO = byICAO
        uirByID = uirs
        traconByPrefix = traconPrefix
        traconVolume = traconVolumes
        volumeGrid = grid
        firBoundaryGrid = firGrid
    }

    /// Loads and builds everything from files (VATSpy.dat, FIR GeoJSON, TRACON GeoJSON, optional extras CSV).
    public static func load(vatspy vatspyURL: URL, firBoundaries firURL: URL, traconBoundaries traconURL: URL,
                            airportExtras extrasURL: URL? = nil) throws -> SectorDatabase {
        let vatspy = try VATSpyParser.parse(contentsOf: vatspyURL)
        let firs = try BoundaryParser.parseFIRs(contentsOf: firURL)
        let tracons = (try? BoundaryParser.parseTRACONs(contentsOf: traconURL)) ?? []
        let extras = extrasURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        return SectorDatabase(vatspy: vatspy, firBoundaries: firs, traconBoundaries: tracons,
                              airports: AirportDatabase(airports: vatspy.airports, extrasCSV: extras))
    }

    /// Loads from a ``MapDataFiles`` set (as returned by ``MapDataClient``).
    public static func load(files: MapDataFiles, airportExtras: URL? = nil) throws -> SectorDatabase {
        try load(vatspy: files.vatspyDat, firBoundaries: files.firBoundaries, traconBoundaries: files.traconBoundaries,
                 airportExtras: airportExtras)
    }

    // MARK: - Lookup

    /// Catalogue volume by id ("FIR:LIRR", "UIR:EURN", "TRACON:N90/JFK").
    public func volume(id: String) -> AirspaceVolume? {
        volumeIndexByID[id].map { volumes[$0] }
    }

    /// Volumes staffed by `controller` (usually one; UIRs are returned as a single combined volume).
    /// Observers and supervisors return `[]`.
    public func volumes(for controller: Controller) -> [AirspaceVolume] {
        volumes(forCallsign: controller.callsign, position: controller.position)
    }

    /// Volumes for a callsign; `position` defaults to the one derived from the suffix.
    public func volumes(forCallsign rawCallsign: String, position: ATCPosition? = nil) -> [AirspaceVolume] {
        let callsign = rawCallsign.uppercased().trimmingCharacters(in: .whitespaces)
        let parts = callsign.split(separator: "_").map(String.init)
        guard !parts.isEmpty else { return [] }
        let position = position ?? ATCPosition(callsign: callsign, facility: .observer)
        let prefixParts = parts.count > 1 ? Array(parts.dropLast()) : parts

        switch position {
        case .center, .flightService:
            return areaVolumes(callsign: callsign, prefixParts: prefixParts, preferOceanic: position == .flightService)
        case .approach, .departure:
            let tracons = traconMatches(callsign: callsign, prefixParts: prefixParts, explicitSuffixOnly: false)
            if !tracons.isEmpty { return tracons }
            return airportCircle(prefixParts: prefixParts, position: position, radius: Radius.approach, kind: .tracon)
        case .tower:
            let tracons = traconMatches(callsign: callsign, prefixParts: prefixParts, explicitSuffixOnly: true)
            if !tracons.isEmpty { return tracons }
            return airportCircle(prefixParts: prefixParts, position: position, radius: Radius.tower, kind: .airport)
        case .ground:
            return airportCircle(prefixParts: prefixParts, position: position, radius: Radius.ground, kind: .airport)
        case .delivery:
            return airportCircle(prefixParts: prefixParts, position: position, radius: Radius.delivery, kind: .airport)
        case .atis:
            return airportCircle(prefixParts: prefixParts, position: position, radius: Radius.atis, kind: .airport)
        case .observer, .supervisor:
            return []
        }
    }

    /// Airport a callsign refers to ("LIRF_TWR" → LIRF, "JFK_GND" → KJFK, pseudo prefixes included).
    public func airport(forCallsign callsign: String) -> Airport? {
        let parts = callsign.uppercased().split(separator: "_").map(String.init)
        guard let first = parts.first else { return nil }
        return airports.airport(callsignPrefix: first)
    }

    /// The FIR boundary containing `point`. Top-level FIRs are preferred over sub-sectors ("EDGG-N");
    /// among those the smallest wins, so overlay areas (e.g. the German FIS "EDXX") lose to real FIRs.
    public func firContaining(_ point: GeoPoint) -> FIRBoundary? {
        let matches = firBoundaryGrid.candidates(at: point).map { firBoundaries[$0] }.filter { $0.geometry.contains(point) }
        return matches.min { a, b in
            let subA = a.id.contains("-"), subB = b.id.contains("-")
            if subA != subB { return !subA }
            return Self.area(a.geometry.bounds) < Self.area(b.geometry.bounds)
        }
    }

    /// Catalogue volumes (FIR, UIR, TRACON) containing `point`, smallest first.
    public func volumesContaining(_ point: GeoPoint) -> [AirspaceVolume] {
        var seen = Set<Int>()
        return volumeGrid.candidates(at: point)
            .filter { seen.insert($0).inserted && volumes[$0].contains(point) }
            .map { volumes[$0] }
            .sorted { Self.area($0.bounds) < Self.area($1.bounds) }
    }

    /// Catalogue volumes whose bounds intersect `bounds` (e.g. the visible map region).
    public func volumes(intersecting bounds: GeoBounds) -> [AirspaceVolume] {
        var seen = Set<Int>()
        return volumeGrid.candidates(in: bounds)
            .filter { seen.insert($0).inserted && volumes[$0].bounds.intersects(bounds) }
            .map { volumes[$0] }
    }

    // MARK: - Rules

    private func areaVolumes(callsign: String, prefixParts: [String], preferOceanic: Bool) -> [AirspaceVolume] {
        func pick(_ indices: [Int]) -> [AirspaceVolume] {
            let candidates = indices.map { volumes[$0] }
            guard candidates.count > 1 else { return candidates }
            let preferred = candidates.filter { $0.isOceanic == preferOceanic }
            return preferred.isEmpty ? candidates : preferred
        }
        let keys = (1...prefixParts.count).reversed().map { prefixParts[0..<$0].joined(separator: "_") }
        // 1. Callsign prefix incl. middle parts, then progressively shorter ("EDGG_E" → "EDGG").
        for key in keys { if let indices = firByPrefix[key], !indices.isEmpty { return pick(indices) } }
        // 2. FIR ICAO ("EDGG-N" written with underscores, or a FIR whose callsign prefix differs).
        for key in keys {
            if let indices = firByICAO[key] ?? firByICAO[key.replacingOccurrences(of: "_", with: "-")], !indices.isEmpty {
                return pick(indices)
            }
        }
        // 3. UIR.
        for key in keys {
            if let index = uirByID[key] ?? uirByID[key.replacingOccurrences(of: "_", with: "-")] { return [volumes[index]] }
        }
        // 4. SimAware sectors with an explicit CTR/FSS suffix (e.g. CZVR sectors).
        return traconMatches(callsign: callsign, prefixParts: prefixParts, explicitSuffixOnly: true)
    }

    private func traconMatches(callsign: String, prefixParts: [String], explicitSuffixOnly: Bool) -> [AirspaceVolume] {
        let suffix = callsign.split(separator: "_").last.map(String.init) ?? ""
        var best: (score: Int, indices: [Int]) = (-1, [])
        for k in stride(from: prefixParts.count, through: 1, by: -1) {
            let key = prefixParts[0..<k].joined(separator: "_")
            for i in traconByPrefix[key] ?? [] {
                let boundary = traconBoundaries[i]
                var score: Int
                if let required = boundary.suffix {
                    guard callsign.hasSuffix("_" + required), callsign.count >= key.count + required.count + 1 else { continue }
                    score = k * 1000 + 500 + required.count
                } else {
                    guard !explicitSuffixOnly, suffix == "APP" || suffix == "DEP" else { continue }
                    score = k * 1000
                }
                if score > best.score { best = (score, [i]) } else if score == best.score { best.indices.append(i) }
            }
        }
        return best.indices.map { volumes[traconVolume[$0]] }
    }

    private func airportCircle(prefixParts: [String], position: ATCPosition, radius: Double,
                               kind: AirspaceVolume.Kind) -> [AirspaceVolume] {
        guard let first = prefixParts.first, let airport = airports.airport(callsignPrefix: first) else { return [] }
        let name = Self.positionName(airport: airport, position: position)
        var prefixes = [airport.icao]
        if !airport.iata.isEmpty { prefixes.append(airport.iata) }
        if !prefixes.contains(first) { prefixes.append(first) }
        return [AirspaceVolume(id: "APT:\(airport.icao):\(position.rawValue)", kind: kind, name: name,
                               callsignPrefixes: prefixes, center: airport.position, radiusNM: radius)]
    }

    static func positionName(airport: Airport, position: ATCPosition) -> String {
        let word: String = switch position {
        case .atis: "ATIS"
        case .delivery: "Delivery"
        case .ground: "Ground"
        case .tower: "Tower"
        case .approach: "Approach"
        case .departure: "Departure"
        case .center: "Control"
        case .flightService: "Radio"
        case .observer: "Observer"
        case .supervisor: "Supervisor"
        }
        return "\(airport.name) \(word)"
    }

    static func displayName(_ name: String, icao: String, suffixes: [String: String]) -> String {
        let upper = icao.uppercased()
        let suffix = (upper.count >= 2 ? suffixes[String(upper.prefix(2))] : nil) ?? upper.first.flatMap { suffixes[String($0)] } ?? ""
        guard !suffix.isEmpty, !name.localizedCaseInsensitiveContains(suffix), !name.contains(" - ") else { return name }
        return "\(name) \(suffix)"
    }

    static func area(_ b: GeoBounds) -> Double {
        let lonSpan = b.crossesAntimeridian ? b.maxLon + 360 - b.minLon : b.maxLon - b.minLon
        return (b.maxLat - b.minLat) * lonSpan
    }
}
