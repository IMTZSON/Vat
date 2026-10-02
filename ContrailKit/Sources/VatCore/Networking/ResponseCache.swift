import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Two-level (memory + disk) cache of raw response bodies, keyed by string.
///
/// Used both for freshness (skip the network while an entry is younger than `maxAge`) and for
/// offline mode: when a request fails, clients serve the last stored body and flag it as stale.
public actor ResponseCache {
    /// A cached body and the moment it was stored.
    public struct Entry: Sendable, Equatable {
        public var data: Data
        public var storedAt: Date

        public init(data: Data, storedAt: Date) {
            self.data = data
            self.storedAt = storedAt
        }

        /// Age relative to `now`, in seconds.
        public func age(at now: Date) -> TimeInterval { now.timeIntervalSince(storedAt) }
    }

    private var memory: [String: Entry] = [:]
    private let directory: URL?
    private let now: @Sendable () -> Date
    private let memoryLimitBytes: Int
    private var memoryBytes = 0

    /// - Parameters:
    ///   - directory: Folder for persisted entries (created on demand); `nil` keeps the cache in memory only.
    ///   - memoryLimitBytes: Soft limit for the in-memory level; older entries are evicted first.
    ///   - now: Clock, injectable for tests.
    public init(directory: URL?, memoryLimitBytes: Int = 64 * 1024 * 1024,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.memoryLimitBytes = memoryLimitBytes
        self.now = now
    }

    /// In-memory cache, handy for previews and tests.
    public static func inMemory() -> ResponseCache { ResponseCache(directory: nil) }

    /// Default on-disk location (`Caches/Contrail/ResponseCache`).
    public static var defaultDirectory: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("Contrail", isDirectory: true)
            .appendingPathComponent("ResponseCache", isDirectory: true)
    }

    /// Returns the entry for `key` if present and, when `maxAge` is given, not older than it.
    public func get(_ key: String, maxAge: TimeInterval? = nil) -> Entry? {
        let entry: Entry
        if let cached = memory[key] {
            entry = cached
        } else if let loaded = loadFromDisk(key) {
            entry = loaded
            insertInMemory(key, loaded)
        } else {
            return nil
        }
        if let maxAge, entry.age(at: now()) > maxAge { return nil }
        return entry
    }

    /// Stores `data` under `key` (timestamped `storedAt`, default now) in memory and on disk.
    public func set(_ key: String, data: Data, storedAt: Date? = nil) {
        let entry = Entry(data: data, storedAt: storedAt ?? now())
        insertInMemory(key, entry)
        writeToDisk(key, entry)
    }

    /// Removes one entry.
    public func remove(_ key: String) {
        if let old = memory.removeValue(forKey: key) { memoryBytes -= old.data.count }
        if let url = fileURL(for: key) { try? FileManager.default.removeItem(at: url) }
    }

    /// Removes every entry (memory and disk).
    public func removeAll() {
        memory.removeAll()
        memoryBytes = 0
        if let directory { try? FileManager.default.removeItem(at: directory) }
    }

    // MARK: - Private

    private func insertInMemory(_ key: String, _ entry: Entry) {
        if let old = memory[key] { memoryBytes -= old.data.count }
        memory[key] = entry
        memoryBytes += entry.data.count
        guard memoryBytes > memoryLimitBytes else { return }
        for (oldKey, oldEntry) in memory.sorted(by: { $0.value.storedAt < $1.value.storedAt }) where oldKey != key {
            memory.removeValue(forKey: oldKey)
            memoryBytes -= oldEntry.data.count
            if memoryBytes <= memoryLimitBytes { break }
        }
    }

    private func fileURL(for key: String) -> URL? {
        guard let directory else { return nil }
        let safe = String(key.unicodeScalars.prefix(80).map {
            CharacterSet.alphanumerics.contains($0) && $0.isASCII ? Character($0) : "_"
        })
        return directory.appendingPathComponent("\(safe)-\(Self.fnv1a(key)).cache")
    }

    /// File layout: 8-byte little-endian `timeIntervalSince1970` bit pattern followed by the body.
    private func writeToDisk(_ key: String, _ entry: Entry) {
        guard let url = fileURL(for: key), let directory else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var bits = entry.storedAt.timeIntervalSince1970.bitPattern.littleEndian
            var blob = Data(bytes: &bits, count: 8)
            blob.append(entry.data)
            try blob.write(to: url, options: .atomic)
        } catch {
            // Disk caching is best effort.
        }
    }

    private func loadFromDisk(_ key: String) -> Entry? {
        guard let url = fileURL(for: key), let blob = try? Data(contentsOf: url), blob.count >= 8 else { return nil }
        var raw: UInt64 = 0
        for (i, byte) in blob.prefix(8).enumerated() { raw |= UInt64(byte) << (8 * UInt64(i)) }
        let time = Double(bitPattern: raw)
        guard time.isFinite else { return nil }
        return Entry(data: Data(blob.dropFirst(8)), storedAt: Date(timeIntervalSince1970: time))
    }

    /// Stable 64-bit FNV-1a hash (Swift's `hashValue` is randomised per process).
    static func fnv1a(_ string: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in string.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return String(hash, radix: 16)
    }
}

/// Where a ``Fetched`` value came from.
public enum FetchSource: String, Sendable, Hashable {
    /// Downloaded just now.
    case network
    /// Served from cache because it was still within its freshness window.
    case cache
    /// Served from cache because the network request failed.
    case staleCache
}

/// A value obtained from the network or, when the network failed, from the offline cache.
public struct Fetched<Value: Sendable>: Sendable {
    /// Where the value came from.
    public typealias Source = FetchSource

    public var value: Value
    /// When the underlying data was downloaded.
    public var fetchedAt: Date
    public var source: Source
    /// The error that forced a stale fallback, if any.
    public var error: NetworkError?

    public init(value: Value, fetchedAt: Date, source: Source, error: NetworkError? = nil) {
        self.value = value
        self.fetchedAt = fetchedAt
        self.source = source
        self.error = error
    }

    /// True when the network failed and the value may be outdated (show an "offline" badge).
    public var isStale: Bool { source == .staleCache }

    /// Transforms the value, keeping the metadata.
    public func map<T: Sendable>(_ transform: (Value) throws -> T) rethrows -> Fetched<T> {
        Fetched<T>(value: try transform(value), fetchedAt: fetchedAt, source: source, error: error)
    }
}

/// Shared "cache first, network, stale fallback" logic used by the small API clients.
struct CachedFetcher: Sendable {
    let http: any HTTPClient
    let cache: ResponseCache
    let now: @Sendable () -> Date

    /// Fetches `request`, decoding with `decode`.
    /// - Parameters:
    ///   - key: Cache key (defaults to the URL).
    ///   - maxAge: Freshness window; a younger cache entry is returned without touching the network.
    ///   - mapStatus: Optional hook to turn specific HTTP statuses into domain errors.
    func fetch<T: Sendable>(
        _ request: URLRequest,
        key: String? = nil,
        maxAge: TimeInterval,
        mapStatus: (@Sendable (HTTPURLResponse, Data) -> Error?)? = nil,
        decode: @Sendable (Data) throws -> T
    ) async throws -> Fetched<T> {
        let cacheKey = key ?? request.url?.absoluteString ?? "unknown"
        if maxAge > 0, let entry = await cache.get(cacheKey), entry.age(at: now()) <= maxAge,
           let value = try? decode(entry.data) {
            return Fetched(value: value, fetchedAt: entry.storedAt, source: .cache)
        }
        do {
            let (data, response) = try await http.send(request)
            if let mapped = mapStatus?(response, data) { throw mapped }
            try NetworkError.check(response)
            let value: T
            do {
                value = try decode(data)
            } catch let error as DecodingError {
                throw NetworkError.decoding(String(describing: error))
            }
            let date = now()
            await cache.set(cacheKey, data: data, storedAt: date)
            return Fetched(value: value, fetchedAt: date, source: .network)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as NetworkError where error.allowsStaleFallback {
            if let entry = await cache.get(cacheKey), let value = try? decode(entry.data) {
                return Fetched(value: value, fetchedAt: entry.storedAt, source: .staleCache, error: error)
            }
            throw error
        } catch let error as NetworkError {
            throw error
        } catch let error where error is URLError {
            let wrapped = NetworkError.wrap(error)
            if wrapped.allowsStaleFallback, let entry = await cache.get(cacheKey), let value = try? decode(entry.data) {
                return Fetched(value: value, fetchedAt: entry.storedAt, source: .staleCache, error: wrapped)
            }
            throw wrapped
        }
    }

    /// GET request helper with an `Accept` header.
    static func get(_ url: URL, accept: String = "application/json") -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(accept, forHTTPHeaderField: "Accept")
        return request
    }
}
