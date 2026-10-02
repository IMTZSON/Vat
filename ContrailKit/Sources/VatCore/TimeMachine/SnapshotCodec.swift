import Foundation

public enum SnapshotCodecError: Error, Sendable, Hashable {
    case badMagic
    case unsupportedVersion(UInt8)
    case truncated
    case invalidStringIndex(Int)
    case invalidUTF8
    case corrupt(String)
}

/// Compact binary format for `CompactSnapshot` (≈ 35–40 bytes per pilot).
///
/// Layout (all fixed-width integers little-endian, `uv` = unsigned LEB128 varint):
/// ```
/// "CTRL"            4 bytes magic
/// version           u8  (= 1)
/// flags             u8  (reserved, 0)
/// timestamp         i64 milliseconds since 1970-01-01 UTC
/// stringCount       uv, then per string: byteLength uv + UTF-8 bytes   (index 0 = "")
/// pilotCount        uv, then per pilot:
///     cid u32 · callsign uv(string index) · lat f32 · lon f32 · altitude i32 · groundspeed i16 · heading i16
///     · departure uv · arrival uv · aircraftType uv
/// controllerCount   uv, then per controller: cid u32 · callsign uv · frequency uv · facility u8
/// ```
/// Decoding is bounds-checked everywhere and throws on malformed or truncated input; it never traps.
public enum SnapshotCodec {
    public static let magic: [UInt8] = Array("CTRL".utf8)
    public static let version: UInt8 = 1
    public static let fileExtension = "ctrl"

    // MARK: Encode

    public static func encode(_ snapshot: CompactSnapshot) -> Data {
        var strings: [String] = [""]
        var index: [String: Int] = ["": 0]
        func intern(_ s: String) -> Int {
            if let i = index[s] { return i }
            strings.append(s)
            index[s] = strings.count - 1
            return strings.count - 1
        }
        // Intern in a deterministic order.
        struct PilotRefs { var callsign, dep, arr, type: Int }
        let pilotRefs = snapshot.pilots.map {
            PilotRefs(callsign: intern($0.callsign), dep: intern($0.departure), arr: intern($0.arrival),
                      type: intern($0.aircraftType))
        }
        let controllerRefs = snapshot.controllers.map { (intern($0.callsign), intern($0.frequency)) }

        var w = SnapshotByteWriter()
        w.bytes.reserveCapacity(32 + snapshot.pilots.count * 40 + snapshot.controllers.count * 16)
        w.bytes.append(contentsOf: magic)
        w.u8(version)
        w.u8(0)
        let ms = (snapshot.timestamp.timeIntervalSince1970 * 1000).rounded()
        w.i64(ms.isFinite && abs(ms) < 9e15 ? Int64(ms) : 0)
        w.uv(UInt64(strings.count))
        for s in strings {
            let utf8 = Array(s.utf8)
            w.uv(UInt64(utf8.count))
            w.bytes.append(contentsOf: utf8)
        }
        w.uv(UInt64(snapshot.pilots.count))
        for (p, r) in zip(snapshot.pilots, pilotRefs) {
            w.u32(UInt32(clamping: p.cid))
            w.uv(UInt64(r.callsign))
            w.u32(p.lat.bitPattern)
            w.u32(p.lon.bitPattern)
            w.u32(UInt32(bitPattern: p.altitude))
            w.u16(UInt16(bitPattern: p.groundspeed))
            w.u16(UInt16(bitPattern: p.heading))
            w.uv(UInt64(r.dep))
            w.uv(UInt64(r.arr))
            w.uv(UInt64(r.type))
        }
        w.uv(UInt64(snapshot.controllers.count))
        for (c, r) in zip(snapshot.controllers, controllerRefs) {
            w.u32(UInt32(clamping: c.cid))
            w.uv(UInt64(r.0))
            w.uv(UInt64(r.1))
            w.u8(c.facility)
        }
        return Data(w.bytes)
    }

    // MARK: Decode

    public static func decode(_ data: Data) throws -> CompactSnapshot {
        var r = SnapshotByteReader(bytes: [UInt8](data))
        guard r.remaining >= 4 else { throw r.remaining == 0 ? SnapshotCodecError.truncated : .badMagic }
        guard try r.take(4) == magic else { throw SnapshotCodecError.badMagic }
        let v = try r.u8()
        guard v == version else { throw SnapshotCodecError.unsupportedVersion(v) }
        _ = try r.u8() // flags
        let ms = try r.i64()
        let timestamp = Date(timeIntervalSince1970: Double(ms) / 1000)

        let stringCount = try r.count(minimumElementSize: 1)
        var strings: [String] = []
        strings.reserveCapacity(stringCount)
        for _ in 0..<stringCount {
            let length = try r.count(minimumElementSize: 1)
            let bytes = try r.take(length)
            guard let s = String(bytes: bytes, encoding: .utf8) else { throw SnapshotCodecError.invalidUTF8 }
            strings.append(s)
        }
        func string(_ i: Int) throws -> String {
            guard i >= 0, i < strings.count else { throw SnapshotCodecError.invalidStringIndex(i) }
            return strings[i]
        }

        let pilotCount = try r.count(minimumElementSize: 24)
        var pilots: [CompactPilot] = []
        pilots.reserveCapacity(pilotCount)
        for _ in 0..<pilotCount {
            let cid = Int(try r.u32())
            let callsign = try string(r.index())
            let lat = Float(bitPattern: try r.u32())
            let lon = Float(bitPattern: try r.u32())
            let altitude = Int32(bitPattern: try r.u32())
            let gs = Int16(bitPattern: try r.u16())
            let heading = Int16(bitPattern: try r.u16())
            let dep = try string(r.index())
            let arr = try string(r.index())
            let type = try string(r.index())
            pilots.append(CompactPilot(cid: cid, callsign: callsign, lat: lat, lon: lon, altitude: altitude,
                                       groundspeed: gs, heading: heading, departure: dep, arrival: arr,
                                       aircraftType: type))
        }

        let controllerCount = try r.count(minimumElementSize: 7)
        var controllers: [CompactController] = []
        controllers.reserveCapacity(controllerCount)
        for _ in 0..<controllerCount {
            let cid = Int(try r.u32())
            let callsign = try string(r.index())
            let frequency = try string(r.index())
            let facility = try r.u8()
            controllers.append(CompactController(cid: cid, callsign: callsign, frequency: frequency, facility: facility))
        }
        return CompactSnapshot(timestamp: timestamp, pilots: pilots, controllers: controllers)
    }

    /// Reads only the timestamp (cheap; used when indexing files without a name convention).
    public static func peekTimestamp(_ data: Data) throws -> Date {
        var r = SnapshotByteReader(bytes: [UInt8](data.prefix(14)))
        guard r.remaining >= 4 else { throw SnapshotCodecError.truncated }
        guard try r.take(4) == magic else { throw SnapshotCodecError.badMagic }
        let v = try r.u8()
        guard v == version else { throw SnapshotCodecError.unsupportedVersion(v) }
        _ = try r.u8()
        return Date(timeIntervalSince1970: Double(try r.i64()) / 1000)
    }
}

struct SnapshotByteWriter {
    var bytes: [UInt8] = []

    mutating func u8(_ v: UInt8) { bytes.append(v) }
    mutating func u16(_ v: UInt16) {
        bytes.append(UInt8(truncatingIfNeeded: v))
        bytes.append(UInt8(truncatingIfNeeded: v >> 8))
    }
    mutating func u32(_ v: UInt32) {
        for shift in stride(from: 0, to: 32, by: 8) { bytes.append(UInt8(truncatingIfNeeded: v >> UInt32(shift))) }
    }
    mutating func i64(_ v: Int64) {
        let u = UInt64(bitPattern: v)
        for shift in stride(from: 0, to: 64, by: 8) { bytes.append(UInt8(truncatingIfNeeded: u >> UInt64(shift))) }
    }
    mutating func uv(_ value: UInt64) {
        var v = value
        while v >= 0x80 {
            bytes.append(UInt8(truncatingIfNeeded: v) | 0x80)
            v >>= 7
        }
        bytes.append(UInt8(v))
    }
}

struct SnapshotByteReader {
    let bytes: [UInt8]
    var offset = 0

    init(bytes: [UInt8]) { self.bytes = bytes }

    var remaining: Int { bytes.count - offset }

    mutating func take(_ n: Int) throws -> [UInt8] {
        guard n >= 0, n <= remaining else { throw SnapshotCodecError.truncated }
        defer { offset += n }
        return Array(bytes[offset..<(offset + n)])
    }

    mutating func u8() throws -> UInt8 {
        guard remaining >= 1 else { throw SnapshotCodecError.truncated }
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func u16() throws -> UInt16 {
        guard remaining >= 2 else { throw SnapshotCodecError.truncated }
        defer { offset += 2 }
        return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    mutating func u32() throws -> UInt32 {
        guard remaining >= 4 else { throw SnapshotCodecError.truncated }
        var v: UInt32 = 0
        for k in 0..<4 { v |= UInt32(bytes[offset + k]) << UInt32(8 * k) }
        offset += 4
        return v
    }

    mutating func i64() throws -> Int64 {
        guard remaining >= 8 else { throw SnapshotCodecError.truncated }
        var v: UInt64 = 0
        for k in 0..<8 { v |= UInt64(bytes[offset + k]) << UInt64(8 * k) }
        offset += 8
        return Int64(bitPattern: v)
    }

    mutating func uv() throws -> UInt64 {
        var result: UInt64 = 0
        var shift: UInt64 = 0
        while true {
            guard remaining >= 1 else { throw SnapshotCodecError.truncated }
            let b = bytes[offset]
            offset += 1
            guard shift < 64 else { throw SnapshotCodecError.corrupt("varint too long") }
            result |= UInt64(b & 0x7F) << shift
            if b & 0x80 == 0 { return result }
            shift += 7
        }
    }

    /// A string-table index.
    mutating func index() throws -> Int {
        let v = try uv()
        guard v <= UInt64(Int32.max) else { throw SnapshotCodecError.invalidStringIndex(Int.max) }
        return Int(v)
    }

    /// An element count, rejected when the remaining bytes cannot possibly hold it.
    mutating func count(minimumElementSize: Int) throws -> Int {
        let v = try uv()
        // Every element needs at least `minimumElementSize` bytes, so larger counts are necessarily
        // truncated/corrupt; this also prevents huge allocations from hostile input.
        guard v <= UInt64(remaining / max(1, minimumElementSize)) else { throw SnapshotCodecError.truncated }
        return Int(v)
    }
}
