import Foundation

/// Summary written as `index.json` at the root of a snapshot directory (served statically by the recorder).
///
/// ```json
/// {"from":"2026-10-01T09:00:00Z","to":"2026-10-02T09:15:00Z","count":5760,"hours":["2026/10/01/09", …]}
/// ```
public struct SnapshotIndex: Codable, Sendable, Hashable {
    public var from: Date?
    public var to: Date?
    public var count: Int
    /// Hour folders, oldest first ("yyyy/MM/dd/HH", UTC).
    public var hours: [String]
    public var retentionDays: Int?
    public var updated: Date?

    public init(from: Date?, to: Date?, count: Int, hours: [String], retentionDays: Int? = nil, updated: Date? = nil) {
        self.from = from
        self.to = to
        self.count = count
        self.hours = hours
        self.retentionDays = retentionDays
        self.updated = updated
    }

    enum CodingKeys: String, CodingKey { case from, to, count, hours, retentionDays, updated }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = c.date(.from)
        to = c.date(.to)
        count = c.int(.count) ?? 0
        hours = c.lenient([String].self, forKey: .hours) ?? []
        retentionDays = c.int(.retentionDays)
        updated = c.date(.updated)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(from.map(FastISO8601.string(from:)), forKey: .from)
        try c.encodeIfPresent(to.map(FastISO8601.string(from:)), forKey: .to)
        try c.encode(count, forKey: .count)
        try c.encode(hours, forKey: .hours)
        try c.encodeIfPresent(retentionDays, forKey: .retentionDays)
        try c.encodeIfPresent(updated.map(FastISO8601.string(from:)), forKey: .updated)
    }
}

/// `index.json` inside each hour folder: the unix timestamps (seconds) of its snapshots.
public struct SnapshotHourIndex: Codable, Sendable, Hashable {
    public var hour: String
    public var timestamps: [Int]

    public init(hour: String, timestamps: [Int]) {
        self.hour = hour
        self.timestamps = timestamps
    }
}

/// Snapshot retention (DECISIONS D-020): default 7 days, at most 30.
public struct SnapshotRetention: Codable, Sendable, Hashable {
    public static let maximumDays = 30
    public static let `default` = SnapshotRetention(days: 7)

    public let days: Int

    public init(days: Int) { self.days = min(max(1, days), Self.maximumDays) }

    public var interval: TimeInterval { TimeInterval(days) * 86_400 }
}

/// Directory-based snapshot store: `<root>/yyyy/MM/dd/HH/<unix seconds>.ctrl` (UTC), FileManager only, so it
/// runs on iOS, macOS and Linux (recorder). Timestamps are indexed in memory after the first scan.
public actor SnapshotStore {
    public nonisolated let directory: URL
    public private(set) var retention: SnapshotRetention
    private var cache: [Int]?

    public init(directory: URL, retention: SnapshotRetention = .default) {
        self.directory = directory
        self.retention = retention
    }

    public func setRetention(_ retention: SnapshotRetention) { self.retention = retention }

    // MARK: Paths

    /// "2026/10/02/09" (UTC).
    public static func hourKey(for date: Date) -> String {
        let seconds = Int(date.timeIntervalSince1970.rounded(.down))
        let days = Int((Double(seconds) / 86_400).rounded(.down))
        let (y, m, d) = FastISO8601.civilFromDays(days)
        let h = ((seconds % 86_400) + 86_400) % 86_400 / 3600
        func pad(_ v: Int) -> String { v < 10 ? "0\(v)" : "\(v)" }
        return "\(y)/\(pad(m))/\(pad(d))/\(pad(h))"
    }

    /// "2026/10/02/09/1790932500.ctrl".
    public static func relativePath(for date: Date) -> String {
        "\(hourKey(for: date))/\(Int(date.timeIntervalSince1970.rounded(.down))).\(SnapshotCodec.fileExtension)"
    }

    nonisolated func url(forSeconds seconds: Int) -> URL {
        directory.appendingPathComponent(Self.relativePath(for: Date(timeIntervalSince1970: TimeInterval(seconds))))
    }

    // MARK: Writing

    /// Stores `snapshot` (same second → overwritten). Returns the file URL.
    @discardableResult
    public func append(_ snapshot: CompactSnapshot) throws -> URL {
        try append(encoded: SnapshotCodec.encode(snapshot), timestamp: snapshot.timestamp)
    }

    @discardableResult
    public func append(encoded data: Data, timestamp: Date) throws -> URL {
        let seconds = Int(timestamp.timeIntervalSince1970.rounded(.down))
        let url = url(forSeconds: seconds)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        var list = loadCache()
        let i = insertionIndex(list, seconds)
        if i >= list.count || list[i] != seconds { list.insert(seconds, at: i) }
        cache = list
        return url
    }

    // MARK: Reading

    public func allTimestamps() -> [Date] { loadCache().map { Date(timeIntervalSince1970: TimeInterval($0)) } }

    public var count: Int { loadCache().count }

    public func timestamps(in interval: DateInterval) -> [Date] {
        let list = loadCache()
        let lo = insertionIndex(list, Int(interval.start.timeIntervalSince1970.rounded(.up)))
        var result: [Date] = []
        var i = lo
        while i < list.count, TimeInterval(list[i]) <= interval.end.timeIntervalSince1970 {
            result.append(Date(timeIntervalSince1970: TimeInterval(list[i])))
            i += 1
        }
        return result
    }

    /// Snapshot stored exactly at `date` (second precision), or `nil`.
    public func load(at date: Date) throws -> CompactSnapshot? {
        let seconds = Int(date.timeIntervalSince1970.rounded(.down))
        let url = url(forSeconds: seconds)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try SnapshotCodec.decode(Data(contentsOf: url))
    }

    public func nearestTimestamp(to date: Date, tolerance: TimeInterval? = nil) -> Date? {
        let list = loadCache()
        guard !list.isEmpty else { return nil }
        let target = date.timeIntervalSince1970
        let i = insertionIndex(list, Int(target.rounded(.down)))
        var best: Int?
        for j in [i - 1, i, i + 1] where j >= 0 && j < list.count {
            if let b = best, abs(TimeInterval(b) - target) <= abs(TimeInterval(list[j]) - target) { continue }
            best = list[j]
        }
        guard let best else { return nil }
        if let tolerance, abs(TimeInterval(best) - target) > tolerance { return nil }
        return Date(timeIntervalSince1970: TimeInterval(best))
    }

    public func nearest(to date: Date, tolerance: TimeInterval? = nil) throws -> CompactSnapshot? {
        guard let t = nearestTimestamp(to: date, tolerance: tolerance) else { return nil }
        return try load(at: t)
    }

    /// Latest snapshot at or before `date`, and the next one after it (for replay interpolation).
    public func bracket(_ date: Date) -> (before: Date?, after: Date?) {
        let list = loadCache()
        let seconds = date.timeIntervalSince1970
        let i = insertionIndex(list, Int(seconds.rounded(.up)))
        var before: Int? = i > 0 ? list[i - 1] : nil
        var after: Int? = i < list.count ? list[i] : nil
        if let a = after, TimeInterval(a) <= seconds { before = a; after = i + 1 < list.count ? list[i + 1] : nil }
        return (before.map { Date(timeIntervalSince1970: TimeInterval($0)) },
                after.map { Date(timeIntervalSince1970: TimeInterval($0)) })
    }

    // MARK: Maintenance

    /// Deletes snapshots strictly older than `date`; removes empty folders. Returns the number of files deleted.
    @discardableResult
    public func purge(olderThan date: Date) -> Int {
        let list = loadCache()
        let cutoff = date.timeIntervalSince1970
        var deleted = 0
        var touchedHours: Set<String> = []
        var kept: [Int] = []
        for s in list {
            if TimeInterval(s) < cutoff {
                let url = url(forSeconds: s)
                if (try? FileManager.default.removeItem(at: url)) != nil || !FileManager.default.fileExists(atPath: url.path) {
                    deleted += 1
                    touchedHours.insert(Self.hourKey(for: Date(timeIntervalSince1970: TimeInterval(s))))
                    continue
                }
            }
            kept.append(s)
        }
        cache = kept
        for hour in touchedHours.sorted() { removeEmptyFolders(hour: hour) }
        return deleted
    }

    /// Applies the retention policy relative to `now`.
    @discardableResult
    public func applyRetention(now: Date) -> Int {
        purge(olderThan: now.addingTimeInterval(-retention.interval))
    }

    /// Size on disk of all files under the store directory.
    public func totalBytes() -> Int64 {
        guard let e = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey])
        else { return 0 }
        var total: Int64 = 0
        while let url = e.nextObject() as? URL {
            if let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
               values.isRegularFile == true {
                total += Int64(values.fileSize ?? 0)
            }
        }
        return total
    }

    /// Hour folders that contain snapshots, oldest first.
    public func hourKeys() -> [String] {
        var keys: [String] = []
        for s in loadCache() {
            let k = Self.hourKey(for: Date(timeIntervalSince1970: TimeInterval(s)))
            if keys.last != k { keys.append(k) }
        }
        return keys
    }

    public func index(now: Date? = nil) -> SnapshotIndex {
        let list = loadCache()
        return SnapshotIndex(
            from: list.first.map { Date(timeIntervalSince1970: TimeInterval($0)) },
            to: list.last.map { Date(timeIntervalSince1970: TimeInterval($0)) },
            count: list.count, hours: hourKeys(), retentionDays: retention.days, updated: now
        )
    }

    /// Writes `index.json` at the root.
    public func writeIndex(now: Date? = nil) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(index(now: now)).write(to: directory.appendingPathComponent("index.json"), options: .atomic)
    }

    /// Writes `<hour>/index.json` listing the timestamps of that hour.
    public func writeHourIndex(for date: Date) throws {
        let hour = Self.hourKey(for: date)
        let folder = directory.appendingPathComponent(hour)
        guard FileManager.default.fileExists(atPath: folder.path) else { return }
        let stamps = loadCache().filter { Self.hourKey(for: Date(timeIntervalSince1970: TimeInterval($0))) == hour }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(SnapshotHourIndex(hour: hour, timestamps: stamps))
            .write(to: folder.appendingPathComponent("index.json"), options: .atomic)
    }

    /// Forces a rescan of the directory (e.g. after external changes).
    public func reload() { cache = nil }

    // MARK: Private

    private func loadCache() -> [Int] {
        if let cache { return cache }
        var result: [Int] = []
        let ext = "." + SnapshotCodec.fileExtension
        if let e = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil) {
            while let url = e.nextObject() as? URL {
                let name = url.lastPathComponent
                guard name.hasSuffix(ext), let s = Int(name.dropLast(ext.count)) else { continue }
                result.append(s)
            }
        }
        result.sort()
        cache = result
        return result
    }

    private func insertionIndex(_ list: [Int], _ value: Int) -> Int {
        var lo = 0, hi = list.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if list[mid] < value { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    private func removeEmptyFolders(hour: String) {
        let fm = FileManager.default
        var components = hour.split(separator: "/").map(String.init)
        while !components.isEmpty {
            let folder = directory.appendingPathComponent(components.joined(separator: "/"))
            let contents = (try? fm.contentsOfDirectory(atPath: folder.path)) ?? []
            let meaningful = contents.filter { $0 != "index.json" && $0 != ".DS_Store" }
            guard meaningful.isEmpty else { return }
            try? fm.removeItem(at: folder)
            components.removeLast()
        }
    }
}
