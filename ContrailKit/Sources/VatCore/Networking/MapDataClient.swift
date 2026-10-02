import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Locations of the sector/airport data files to load.
public struct MapDataFiles: Sendable, Hashable {
    public var vatspyDat: URL
    public var firBoundaries: URL
    public var traconBoundaries: URL
    /// True for each file that comes from the app bundle (no newer download available).
    public var vatspyIsBundled: Bool
    public var firIsBundled: Bool
    public var traconIsBundled: Bool
    /// VATSpy data commit hash of the downloaded files, when known.
    public var commitHash: String?

    public init(vatspyDat: URL, firBoundaries: URL, traconBoundaries: URL, vatspyIsBundled: Bool = true,
                firIsBundled: Bool = true, traconIsBundled: Bool = true, commitHash: String? = nil) {
        self.vatspyDat = vatspyDat
        self.firBoundaries = firBoundaries
        self.traconBoundaries = traconBoundaries
        self.vatspyIsBundled = vatspyIsBundled
        self.firIsBundled = firIsBundled
        self.traconIsBundled = traconIsBundled
        self.commitHash = commitHash
    }
}

/// Keeps VATSpy data and SimAware TRACON boundaries up to date (at most one check per day,
/// DECISIONS D-012). Failures are silent: the freshest available files (download or bundle) are returned.
public actor MapDataClient {
    public static let checkInterval: TimeInterval = 24 * 3600

    private let http: any HTTPClient
    private let directory: URL
    private let bundled: MapDataFiles
    private let now: @Sendable () -> Date

    private struct Metadata: Codable {
        var lastCheck: Date?
        var commitHash: String?
    }

    /// - Parameters:
    ///   - directory: Writable folder for downloaded files (Application Support recommended).
    ///   - bundled: The files shipped in the app bundle.
    public init(http: any HTTPClient, directory: URL, bundled: MapDataFiles,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        self.directory = directory
        self.bundled = bundled
        self.now = now
    }

    /// The best files available right now, without network access.
    public func currentFiles() -> MapDataFiles {
        let fm = FileManager.default
        let meta = loadMetadata()
        var files = bundled
        if fm.fileExists(atPath: vatspyURL.path) { files.vatspyDat = vatspyURL; files.vatspyIsBundled = false }
        if fm.fileExists(atPath: firURL.path) { files.firBoundaries = firURL; files.firIsBundled = false }
        if fm.fileExists(atPath: traconURL.path) { files.traconBoundaries = traconURL; files.traconIsBundled = false }
        files.commitHash = (files.vatspyIsBundled && files.firIsBundled) ? nil : meta.commitHash
        return files
    }

    /// Downloads newer data when the last check is older than a day (or `force`), then returns the
    /// freshest files. Never throws.
    @discardableResult
    public func refreshIfNeeded(force: Bool = false) async -> MapDataFiles {
        var meta = loadMetadata()
        let current = now()
        if !force, let last = meta.lastCheck, current.timeIntervalSince(last) < Self.checkInterval {
            return currentFiles()
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        // 1. VATSpy data via the map_data manifest (falls back to the raw GitHub files).
        var datURL = VatsimEndpoints.vatspyDatRaw
        var firBoundariesURL = VatsimEndpoints.vatspyBoundariesRaw
        var newHash: String?
        if let manifest = try? await download(VatsimEndpoints.mapData),
           let decoded = try? JSONDecoder().decode(MapDataManifest.self, from: manifest) {
            if let url = decoded.vatspyDatURL { datURL = url }
            if let url = decoded.firBoundariesURL { firBoundariesURL = url }
            newHash = decoded.commitHash
        }
        let haveDownloads = FileManager.default.fileExists(atPath: vatspyURL.path)
            && FileManager.default.fileExists(atPath: firURL.path)
        if newHash == nil || newHash != meta.commitHash || !haveDownloads {
            if let dat = try? await download(datURL), Self.looksLikeVATSpy(dat),
               let fir = try? await download(firBoundariesURL), Self.looksLikeGeoJSON(fir) {
                write(dat, to: vatspyURL)
                write(fir, to: firURL)
                meta.commitHash = newHash
            }
        }

        // 2. SimAware TRACON boundaries (latest release).
        if let tracon = try? await download(VatsimEndpoints.simAwareTRACON), Self.looksLikeGeoJSON(tracon) {
            write(tracon, to: traconURL)
        }

        meta.lastCheck = current
        saveMetadata(meta)
        return currentFiles()
    }

    // MARK: - Private

    private var vatspyURL: URL { directory.appendingPathComponent("VATSpy.dat") }
    private var firURL: URL { directory.appendingPathComponent("FIRBoundaries.geojson") }
    private var traconURL: URL { directory.appendingPathComponent("TRACONBoundaries.geojson") }
    private var metadataURL: URL { directory.appendingPathComponent("mapdata-meta.json") }

    private func download(_ url: URL) async throws -> Data {
        let (data, response) = try await http.send(URLRequest(url: url))
        try NetworkError.check(response)
        guard response.statusCode == 200, !data.isEmpty else { throw NetworkError.invalidResponse }
        return data
    }

    private func write(_ data: Data, to url: URL) {
        try? data.write(to: url, options: .atomic)
    }

    private func loadMetadata() -> Metadata {
        guard let data = try? Data(contentsOf: metadataURL),
              let meta = try? JSONDecoder().decode(Metadata.self, from: data) else { return Metadata() }
        return meta
    }

    private func saveMetadata(_ meta: Metadata) {
        if let data = try? JSONEncoder().encode(meta) { write(data, to: metadataURL) }
    }

    static func looksLikeVATSpy(_ data: Data) -> Bool {
        let text = String(decoding: data.prefix(2_000_000), as: UTF8.self)
        return text.contains("[Airports]") && text.contains("[FIRs]")
    }

    static func looksLikeGeoJSON(_ data: Data) -> Bool {
        let head = String(decoding: data.prefix(512), as: UTF8.self)
        return head.contains("FeatureCollection") && data.count > 1000
    }
}
