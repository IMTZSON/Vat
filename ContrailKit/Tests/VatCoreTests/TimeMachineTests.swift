import Foundation
import XCTest
@testable import VatCore

final class TimeMachineTests: XCTestCase {
    let t0 = LogicFixtures.date("2026-10-02T09:15:00Z")

    func sample(_ timestamp: Date? = nil) -> CompactSnapshot {
        CompactSnapshot(
            timestamp: timestamp ?? t0,
            pilots: [
                CompactPilot(cid: 1_234_567, callsign: "AZA123", lat: 41.8, lon: 12.25, altitude: 35_000, groundspeed: 450,
                             heading: 315, departure: "LIRF", arrival: "EGLL", aircraftType: "A320"),
                CompactPilot(cid: 7_654_321, callsign: "DLH4AB", lat: -33.5, lon: -179.9, altitude: -20, groundspeed: 0,
                             heading: 0, departure: "", arrival: "", aircraftType: ""),
                CompactPilot(cid: 42, callsign: "ÜMLAUT1", lat: 0, lon: 0, altitude: Int32.max, groundspeed: Int16.min,
                             heading: 359, departure: "LIRF", arrival: "LIRF", aircraftType: "Ä320"),
            ],
            controllers: [
                CompactController(cid: 9, callsign: "LIRR_CTR", frequency: "128.800", facility: 6),
                CompactController(cid: 10, callsign: "LIRF_ATIS", frequency: "121.700", facility: 4),
            ]
        )
    }

    // MARK: Codec

    func testRoundTrip() throws {
        let snapshot = sample()
        let data = SnapshotCodec.encode(snapshot)
        XCTAssertEqual(Array(data.prefix(4)), Array("CTRL".utf8))
        XCTAssertEqual(data[4], SnapshotCodec.version)
        XCTAssertEqual(try SnapshotCodec.decode(data), snapshot)
        XCTAssertEqual(try SnapshotCodec.peekTimestamp(data), t0)
        // Fractional milliseconds are kept.
        var precise = snapshot
        precise.timestamp = t0.addingTimeInterval(0.123)
        XCTAssertEqual(try SnapshotCodec.decode(SnapshotCodec.encode(precise)).timestamp.timeIntervalSince1970,
                       precise.timestamp.timeIntervalSince1970, accuracy: 0.0005)
        // Empty snapshot.
        let empty = CompactSnapshot(timestamp: t0)
        XCTAssertEqual(try SnapshotCodec.decode(SnapshotCodec.encode(empty)), empty)
        // Deterministic.
        XCTAssertEqual(SnapshotCodec.encode(snapshot), SnapshotCodec.encode(snapshot))
    }

    func testFromFeedStoresNoNames() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "vatsim-data-sample", withExtension: "json", subdirectory: "Fixtures"))
        let feed = try VatsimFeed.decode(from: Data(contentsOf: url))
        // The feed timestamp has 7 fractional digits; the codec keeps milliseconds, so use a round time here.
        let snapshot = CompactSnapshot(snapshot: feed, at: t0)
        XCTAssertEqual(snapshot.pilots.map(\.callsign), feed.pilots.map(\.callsign))
        XCTAssertEqual(snapshot.pilots.first?.departure, feed.pilots.first?.flightPlan?.departure)
        XCTAssertEqual(snapshot.pilots.first?.aircraftType, "A320")
        XCTAssertFalse(snapshot.controllers.contains { $0.position == .observer }, "observers skipped")
        XCTAssertTrue(snapshot.controllers.contains { $0.position == .atis }, "ATIS kept")
        let data = SnapshotCodec.encode(snapshot)
        let text = String(decoding: data, as: UTF8.self)
        for name in feed.pilots.map(\.name) + feed.controllers.map(\.name) where !name.isEmpty {
            XCTAssertFalse(text.contains(name), "name '\(name)' must not be stored (D-020)")
        }
        XCTAssertEqual(try SnapshotCodec.decode(data), snapshot)
    }

    func testTruncatedAndCorruptDataThrows() {
        let data = SnapshotCodec.encode(sample())
        for length in 0..<data.count {
            XCTAssertThrowsError(try SnapshotCodec.decode(data.prefix(length)), "prefix \(length)")
        }
        // Slices with a non-zero start index decode too.
        let padded = Data([0, 0]) + data
        XCTAssertEqual(try SnapshotCodec.decode(padded.dropFirst(2)), sample())

        XCTAssertThrowsError(try SnapshotCodec.decode(Data("NOPE....".utf8))) { XCTAssertEqual($0 as? SnapshotCodecError, .badMagic) }
        var version = data
        version[4] = 99
        XCTAssertThrowsError(try SnapshotCodec.decode(version)) { XCTAssertEqual($0 as? SnapshotCodecError, .unsupportedVersion(99)) }
        // Huge declared count must not allocate or crash.
        var w = SnapshotByteWriter()
        w.bytes = Array("CTRL".utf8) + [1, 0]
        w.i64(0)
        w.uv(UInt64.max >> 1)
        XCTAssertThrowsError(try SnapshotCodec.decode(Data(w.bytes)))
        // Bad string index.
        var bad = SnapshotByteWriter()
        bad.bytes = Array("CTRL".utf8) + [1, 0]
        bad.i64(0)
        bad.uv(1); bad.uv(0) // one empty string
        bad.uv(1) // one pilot
        bad.u32(1); bad.uv(5) // callsign index 5 does not exist
        bad.bytes += [UInt8](repeating: 0, count: 30)
        XCTAssertThrowsError(try SnapshotCodec.decode(Data(bad.bytes))) { XCTAssertEqual($0 as? SnapshotCodecError, .invalidStringIndex(5)) }
        // Over-long varint.
        var long = SnapshotByteWriter()
        long.bytes = Array("CTRL".utf8) + [1, 0]
        long.i64(0)
        long.bytes += [UInt8](repeating: 0xFF, count: 12)
        XCTAssertThrowsError(try SnapshotCodec.decode(Data(long.bytes)))
        // Random garbage after a valid header never traps.
        var rng = LogicRNG(seed: 7)
        for _ in 0..<300 {
            var bytes = Array("CTRL".utf8) + [1, 0]
            bytes += (0..<Int(rng.next() % 200)).map { _ in UInt8(truncatingIfNeeded: rng.next()) }
            _ = try? SnapshotCodec.decode(Data(bytes))
        }
        // Random byte flips in a valid payload never trap.
        for _ in 0..<300 {
            var corrupted = data
            let i = Int(rng.next() % UInt64(data.count))
            corrupted[i] ^= UInt8(truncatingIfNeeded: rng.next() | 1)
            _ = try? SnapshotCodec.decode(corrupted)
        }
    }

    func syntheticSnapshot(pilots count: Int) -> CompactSnapshot {
        var rng = LogicRNG(seed: 42)
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        func word(_ n: Int) -> String { String((0..<n).map { _ in letters[Int(rng.next() % 26)] }) }
        let airports = (0..<400).map { _ in word(4) }
        let types = ["A320", "B738", "A321", "B77W", "A359", "C172", "B789", "A20N", "E190", "CRJ9", "DH8D", "B744"]
        let airlines = (0..<120).map { _ in word(3) }
        let pilots = (0..<count).map { i -> CompactPilot in
            CompactPilot(
                cid: 800_000 + Int(rng.next() % 1_200_000),
                callsign: "\(airlines[Int(rng.next() % 120)])\(i)\(i % 3 == 0 ? word(1) : "")",
                lat: Float(Double(rng.next() % 180_000) / 1_000 - 90), lon: Float(Double(rng.next() % 360_000) / 1_000 - 180),
                altitude: Int32(rng.next() % 43_000), groundspeed: Int16(rng.next() % 520), heading: Int16(rng.next() % 360),
                departure: i % 10 == 0 ? "" : airports[Int(rng.next() % 400)],
                arrival: i % 10 == 0 ? "" : airports[Int(rng.next() % 400)],
                aircraftType: types[Int(rng.next() % UInt64(types.count))]
            )
        }
        let controllers = (0..<150).map { i in
            CompactController(cid: 1_000_000 + i, callsign: "\(airports[i])_\(["TWR", "APP", "CTR", "GND"][i % 4])",
                              frequency: "1\(18 + i % 18).\(100 + i % 900)", facility: UInt8(2 + i % 5))
        }
        return CompactSnapshot(timestamp: t0, pilots: pilots, controllers: controllers)
    }

    func testSizeBudgetFor1500Pilots() throws {
        let snapshot = syntheticSnapshot(pilots: 1_500)
        let data = SnapshotCodec.encode(snapshot)
        print("SnapshotCodec: 1500 pilots + 150 ATC = \(data.count) bytes")
        XCTAssertLessThan(data.count, 100_000, "1500 pilots must fit in < 100 KB (got \(data.count))")
        XCTAssertLessThan(data.count, 70_000)
        let decoded = try SnapshotCodec.decode(data)
        XCTAssertEqual(decoded, snapshot)
        // A few random truncation points on the big payload.
        for cut in [7, 100, data.count / 3, data.count / 2, data.count - 1] {
            XCTAssertThrowsError(try SnapshotCodec.decode(data.prefix(cut)))
        }
    }

    // MARK: Store

    func makeStore(retention: SnapshotRetention = .default) throws -> (SnapshotStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("contrail-store-\(UUID().uuidString)")
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return (SnapshotStore(directory: dir, retention: retention), dir)
    }

    func testStoreAppendLoadNearestPurge() async throws {
        let (store, dir) = try makeStore()
        let times = [t0, t0.addingTimeInterval(15), t0.addingTimeInterval(30), t0.addingTimeInterval(3_600), t0.addingTimeInterval(86_400)]
        for t in times { try await store.append(sample(t)) }
        XCTAssertEqual(SnapshotStore.hourKey(for: t0), "2026/10/02/09")
        XCTAssertEqual(SnapshotStore.relativePath(for: t0), "2026/10/02/09/1790932500.ctrl")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2026/10/02/09/1790932500.ctrl").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2026/10/02/10").path))
        let count = await store.count
        XCTAssertEqual(count, 5)

        let inHour = await store.timestamps(in: DateInterval(start: t0, duration: 30))
        XCTAssertEqual(inHour, Array(times.prefix(3)))
        let loaded = try await store.load(at: t0.addingTimeInterval(15))
        XCTAssertEqual(loaded, sample(t0.addingTimeInterval(15)))
        let missing = try await store.load(at: t0.addingTimeInterval(16))
        XCTAssertNil(missing)
        let nearest = try await store.nearest(to: t0.addingTimeInterval(20))
        XCTAssertEqual(nearest?.timestamp, t0.addingTimeInterval(15))
        let nearestLate = await store.nearestTimestamp(to: t0.addingTimeInterval(2_000))
        XCTAssertEqual(nearestLate, t0.addingTimeInterval(3_600), "1600 s away vs 1970 s")
        let none = await store.nearestTimestamp(to: t0.addingTimeInterval(2_000), tolerance: 60)
        XCTAssertNil(none)
        let bracket = await store.bracket(t0.addingTimeInterval(20))
        XCTAssertEqual(bracket.before, t0.addingTimeInterval(15))
        XCTAssertEqual(bracket.after, t0.addingTimeInterval(30))
        let exact = await store.bracket(t0.addingTimeInterval(30))
        XCTAssertEqual(exact.before, t0.addingTimeInterval(30))
        XCTAssertEqual(exact.after, t0.addingTimeInterval(3_600))
        let hours = await store.hourKeys()
        XCTAssertEqual(hours, ["2026/10/02/09", "2026/10/02/10", "2026/10/03/09"])
        let bytes = await store.totalBytes()
        XCTAssertGreaterThan(bytes, 0)

        // Index files.
        try await store.writeIndex(now: t0.addingTimeInterval(86_400))
        try await store.writeHourIndex(for: t0)
        let index = try JSONDecoder().decode(SnapshotIndex.self, from: Data(contentsOf: dir.appendingPathComponent("index.json")))
        XCTAssertEqual(index.count, 5)
        XCTAssertEqual(index.from, t0)
        XCTAssertEqual(index.to, t0.addingTimeInterval(86_400))
        XCTAssertEqual(index.hours.first, "2026/10/02/09")
        let rawIndex = try String(contentsOf: dir.appendingPathComponent("index.json"), encoding: .utf8)
        XCTAssertTrue(rawIndex.contains("\"from\":\"2026-10-02T09:15:00Z\""), rawIndex)
        let hourIndex = try JSONDecoder().decode(SnapshotHourIndex.self,
                                                 from: Data(contentsOf: dir.appendingPathComponent("2026/10/02/09/index.json")))
        XCTAssertEqual(hourIndex.timestamps, [1_790_932_500, 1_790_932_515, 1_790_932_530])

        // A fresh store on the same directory rescans the files.
        let reopened = SnapshotStore(directory: dir)
        let reopenedTimes = await reopened.allTimestamps()
        XCTAssertEqual(reopenedTimes, times)

        // Purge.
        let removedFirst = await store.purge(olderThan: t0.addingTimeInterval(10))
        XCTAssertEqual(removedFirst, 1)
        let removedHour = await store.purge(olderThan: t0.addingTimeInterval(3_000))
        XCTAssertEqual(removedHour, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2026/10/02/09").path), "empty hour folder removed")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2026/10/02/10").path))
        let remaining = await store.allTimestamps()
        XCTAssertEqual(remaining, [t0.addingTimeInterval(3_600), t0.addingTimeInterval(86_400)])
    }

    func testRetentionPolicy() async throws {
        XCTAssertEqual(SnapshotRetention(days: 90).days, 30)
        XCTAssertEqual(SnapshotRetention(days: 0).days, 1)
        XCTAssertEqual(SnapshotRetention.default.days, 7)
        let (store, dir) = try makeStore(retention: SnapshotRetention(days: 1))
        try await store.append(sample(t0.addingTimeInterval(-2 * 86_400)))
        try await store.append(sample(t0.addingTimeInterval(-3_600)))
        try await store.append(sample(t0))
        let removed = await store.applyRetention(now: t0)
        XCTAssertEqual(removed, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2026/09/30").path), "empty day folder removed")
        await store.setRetention(SnapshotRetention(days: 45))
        let days = await store.retention.days
        XCTAssertEqual(days, 30)
        // Non-snapshot files are ignored when scanning.
        try Data("x".utf8).write(to: dir.appendingPathComponent("notes.txt"))
        await store.reload()
        let count = await store.count
        XCTAssertEqual(count, 2)
    }

    // MARK: Replay

    func testInterpolationMidpointHeadingAndAppearDisappear() throws {
        let a = CompactSnapshot(timestamp: t0, pilots: [
            CompactPilot(cid: 1, callsign: "MOVE", lat: 0, lon: 0, altitude: 10_000, groundspeed: 400, heading: 350),
            CompactPilot(cid: 2, callsign: "GONE", lat: 10, lon: 10, altitude: 5_000, groundspeed: 200, heading: 90),
            CompactPilot(cid: 4, callsign: "JUMP", lat: 0, lon: 0, altitude: 0, groundspeed: 0, heading: 0),
        ], controllers: [CompactController(cid: 9, callsign: "OLD_CTR", frequency: "128.000", facility: 6)])
        let b = CompactSnapshot(timestamp: t0.addingTimeInterval(60), pilots: [
            CompactPilot(cid: 1, callsign: "MOVE", lat: 0, lon: 1, altitude: 12_000, groundspeed: 420, heading: 10),
            CompactPilot(cid: 3, callsign: "NEW", lat: 20, lon: 20, altitude: 0, groundspeed: 0, heading: 0),
            CompactPilot(cid: 4, callsign: "JUMP", lat: 40, lon: 40, altitude: 0, groundspeed: 0, heading: 0),
        ], controllers: [CompactController(cid: 10, callsign: "NEW_CTR", frequency: "129.000", facility: 6)])

        let mid = ReplayInterpolator.interpolate(from: a, to: b, at: t0.addingTimeInterval(30))
        XCTAssertEqual(mid.timestamp, t0.addingTimeInterval(30))
        let move = try XCTUnwrap(mid.pilots.first { $0.callsign == "MOVE" })
        XCTAssertEqual(Double(move.lat), 0, accuracy: 1e-5)
        XCTAssertEqual(Double(move.lon), 0.5, accuracy: 1e-5)
        XCTAssertEqual(move.altitude, 11_000)
        XCTAssertEqual(move.groundspeed, 410)
        XCTAssertEqual(move.heading, 0, "350 → 10 through north")
        XCTAssertNotNil(mid.pilots.first { $0.callsign == "GONE" }, "still visible before the boundary")
        XCTAssertNil(mid.pilots.first { $0.callsign == "NEW" }, "appears at the boundary")
        let jump = try XCTUnwrap(mid.pilots.first { $0.callsign == "JUMP" })
        XCTAssertTrue(jump.lat == 0 || jump.lat == 40, "jumps are not interpolated")
        XCTAssertEqual(mid.controllers.map(\.callsign), ["OLD_CTR"])

        let quarter = ReplayInterpolator.interpolate(from: a, to: b, at: t0.addingTimeInterval(15))
        XCTAssertEqual(quarter.pilots.first { $0.callsign == "MOVE" }?.heading, 355)

        // Boundaries reproduce the snapshots.
        XCTAssertEqual(ReplayInterpolator.interpolate(from: a, to: b, at: t0).pilots, a.pilots)
        let end = ReplayInterpolator.interpolate(from: a, to: b, at: b.timestamp)
        XCTAssertEqual(end.pilots, b.pilots)
        XCTAssertEqual(end.controllers.map(\.callsign), ["NEW_CTR"])
        XCTAssertNil(end.pilots.first { $0.callsign == "GONE" })

        XCTAssertEqual(ReplayInterpolator.interpolateHeading(90, 270, 0.5), 180, accuracy: 1e-9)
        XCTAssertEqual(ReplayInterpolator.interpolateHeading(10, 350, 0.25), 5, accuracy: 1e-9)
    }

    func testInterpolationAcrossAntimeridian() throws {
        let a = CompactSnapshot(timestamp: t0, pilots: [
            CompactPilot(cid: 1, callsign: "PAC1", lat: 30, lon: 179.5, altitude: 37_000, groundspeed: 480, heading: 90),
        ])
        let b = CompactSnapshot(timestamp: t0.addingTimeInterval(60), pilots: [
            CompactPilot(cid: 1, callsign: "PAC1", lat: 30, lon: -179.5, altitude: 37_000, groundspeed: 480, heading: 90),
        ])
        let p = try XCTUnwrap(ReplayInterpolator.interpolate(from: a, to: b, at: t0.addingTimeInterval(30)).pilots.first)
        XCTAssertEqual(abs(Double(p.lon)), 180, accuracy: 0.01, "goes across the date line, not around the world")
        XCTAssertGreaterThan(Double(p.lat), 30, "great circle bulges poleward")
        let q = try XCTUnwrap(ReplayInterpolator.interpolate(from: a, to: b, at: t0.addingTimeInterval(45)).pilots.first)
        XCTAssertEqual(Double(q.lon), -179.75, accuracy: 0.01)
    }

    func testReplayTimeline() throws {
        let stamps = [0, 15, 30, 300, 315, 15].map { t0.addingTimeInterval(TimeInterval($0)) }
        let timeline = ReplayTimeline(timestamps: stamps)
        XCTAssertEqual(timeline.timestamps.count, 5, "sorted and unique")
        XCTAssertEqual(timeline.duration, 315)
        XCTAssertEqual(timeline.gaps, [DateInterval(start: t0.addingTimeInterval(30), end: t0.addingTimeInterval(300))])
        XCTAssertEqual(timeline.frameIndex(forSliderValue: 0), 0)
        XCTAssertEqual(timeline.frameIndex(forSliderValue: 1), 4)
        XCTAssertEqual(timeline.frameIndex(forSliderValue: -3), 0)
        XCTAssertEqual(timeline.frameIndex(forSliderValue: 0.5), 2)
        XCTAssertEqual(timeline.date(forSliderValue: 0.5), t0.addingTimeInterval(157.5))
        XCTAssertEqual(timeline.sliderValue(for: t0.addingTimeInterval(315)), 1)
        XCTAssertTrue(timeline.isInGap(t0.addingTimeInterval(100)))
        XCTAssertFalse(timeline.isInGap(t0.addingTimeInterval(20)))
        let br = try XCTUnwrap(timeline.bracket(for: t0.addingTimeInterval(20)))
        XCTAssertEqual(br.lower, 1)
        XCTAssertEqual(br.upper, 2)
        XCTAssertEqual(br.fraction, 5.0 / 15, accuracy: 1e-9)
        XCTAssertFalse(br.isGap)
        XCTAssertTrue(try XCTUnwrap(timeline.bracket(for: t0.addingTimeInterval(100))).isGap)
        XCTAssertNil(ReplayTimeline(timestamps: []).frameIndex(forSliderValue: 0.5))
    }
}

/// Deterministic PRNG for synthetic data.
struct LogicRNG {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
