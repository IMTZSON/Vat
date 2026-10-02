import Foundation

/// `https://status.vatsim.net/status.json`:
/// `{"data":{"v3":[urls],"transceivers":[urls],"servers":[urls],"servers_sweatbox":[urls],"servers_all":[urls]},
///   "user":[urls], "metar":[urls]}`
public struct VatsimStatus: Decodable, Sendable, Equatable {
    /// Data feed v3 mirrors.
    public var feedURLs: [URL]
    /// Transceivers feed mirrors.
    public var transceiversURLs: [URL]
    /// FSD server list URLs.
    public var serversURLs: [URL]
    public var userURLs: [URL]
    public var metarURLs: [URL]

    public init(feedURLs: [URL] = [], transceiversURLs: [URL] = [], serversURLs: [URL] = [],
                userURLs: [URL] = [], metarURLs: [URL] = []) {
        self.feedURLs = feedURLs
        self.transceiversURLs = transceiversURLs
        self.serversURLs = serversURLs
        self.userURLs = userURLs
        self.metarURLs = metarURLs
    }

    enum CodingKeys: String, CodingKey { case data, user, metar }
    enum DataKeys: String, CodingKey { case v3, transceivers, servers }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func urls<K: CodingKey>(_ container: KeyedDecodingContainer<K>?, _ key: K) -> [URL] {
            guard let container else { return [] }
            if let list = container.lenient([String?].self, forKey: key) {
                return list.compactMap { $0.flatMap(Self.url) }
            }
            if let single = container.lenient(String.self, forKey: key) { return Self.url(single).map { [$0] } ?? [] }
            return []
        }
        let data = try? c.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        feedURLs = urls(data, .v3)
        transceiversURLs = urls(data, .transceivers)
        serversURLs = urls(data, .servers)
        userURLs = urls(c, .user)
        metarURLs = urls(c, .metar)
    }

    private static func url(_ string: String) -> URL? {
        let trimmed = string.trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http"
        else { return nil }
        return url
    }
}

/// `https://api.vatsim.net/api/map_data/` — current VATSpy data URLs. Decoded leniently: keys may
/// sit at the top level or under `data`.
public struct MapDataManifest: Decodable, Sendable, Equatable {
    public var vatspyDatURL: URL?
    public var firBoundariesURL: URL?
    public var commitHash: String?

    public init(vatspyDatURL: URL? = nil, firBoundariesURL: URL? = nil, commitHash: String? = nil) {
        self.vatspyDatURL = vatspyDatURL
        self.firBoundariesURL = firBoundariesURL
        self.commitHash = commitHash
    }

    enum CodingKeys: String, CodingKey {
        case data
        case vatspyDat = "vatspy_dat_url"
        case firBoundaries = "fir_boundaries_geojson_url"
        case commit = "current_commit_hash"
    }

    public init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: CodingKeys.self)
        let c = (try? root.nestedContainer(keyedBy: CodingKeys.self, forKey: .data)) ?? root
        vatspyDatURL = (c.optionalString(.vatspyDat) ?? root.optionalString(.vatspyDat)).flatMap(URL.init(string:))
        firBoundariesURL = (c.optionalString(.firBoundaries) ?? root.optionalString(.firBoundaries)).flatMap(URL.init(string:))
        commitHash = c.optionalString(.commit) ?? root.optionalString(.commit)
    }
}
