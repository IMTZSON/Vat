import Foundation

// Lenient decoding helpers (DECISIONS D-011).
// The VATSIM feed is produced by several services and fields occasionally go missing, become `null`
// or change type (e.g. numbers as strings). None of that may crash the app or drop a whole record.

extension KeyedDecodingContainer {
    /// Decodes a value if present and of the right type, otherwise `nil`. Never throws.
    public func lenient<T: Decodable>(_ type: T.Type, forKey key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }

    /// String value, accepting numbers too. Missing → `fallback`.
    public func string(_ key: Key, default fallback: String = "") -> String {
        optionalString(key) ?? fallback
    }

    public func optionalString(_ key: Key) -> String? {
        if let s = lenient(String.self, forKey: key) { return s }
        if let i = lenient(Int.self, forKey: key) { return String(i) }
        if let d = lenient(Double.self, forKey: key) { return String(d) }
        return nil
    }

    /// Int value, accepting doubles and numeric strings.
    public func int(_ key: Key) -> Int? {
        if let i = lenient(Int.self, forKey: key) { return i }
        if let d = lenient(Double.self, forKey: key), d.isFinite { return Int(d) }
        if let s = lenient(String.self, forKey: key) {
            let t = s.trimmingCharacters(in: .whitespaces)
            if let i = Int(t) { return i }
            if let d = Double(t), d.isFinite { return Int(d) }
        }
        return nil
    }

    /// Double value, accepting ints and numeric strings.
    public func double(_ key: Key) -> Double? {
        if let d = lenient(Double.self, forKey: key) { return d.isFinite ? d : nil }
        if let i = lenient(Int.self, forKey: key) { return Double(i) }
        if let s = lenient(String.self, forKey: key), let d = Double(s.trimmingCharacters(in: .whitespaces)) {
            return d.isFinite ? d : nil
        }
        return nil
    }

    public func bool(_ key: Key) -> Bool? {
        if let b = lenient(Bool.self, forKey: key) { return b }
        if let i = lenient(Int.self, forKey: key) { return i != 0 }
        if let s = lenient(String.self, forKey: key) {
            switch s.lowercased() {
            case "true", "yes", "1": return true
            case "false", "no", "0": return false
            default: return nil
            }
        }
        return nil
    }

    /// ISO-8601 date (VATSIM uses up to 7 fractional digits) or `yyyy-MM-dd HH:mm:ss` (UTC).
    public func date(_ key: Key) -> Date? {
        guard let s = lenient(String.self, forKey: key) else { return nil }
        return FastISO8601.parse(s)
    }

    /// Array of decodable elements; elements that fail to decode are skipped individually.
    public func lossyArray<T: Decodable>(_ type: T.Type, forKey key: Key) -> [T] {
        (try? decodeIfPresent(LossyArray<T>.self, forKey: key))??.elements ?? []
    }
}

/// An array that skips elements failing to decode instead of failing as a whole.
public struct LossyArray<Element: Decodable>: Decodable {
    public var elements: [Element]

    public init(elements: [Element]) { self.elements = elements }

    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var result: [Element] = []
        if let count = container.count { result.reserveCapacity(count) }
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                result.append(element)
            } else {
                // Advance past the broken element.
                _ = try? container.decode(Skip.self)
            }
        }
        elements = result
    }

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }
}

/// Coding key usable with any string, for dynamic dictionaries.
public struct AnyCodingKey: CodingKey, Hashable, Sendable {
    public var stringValue: String
    public var intValue: Int?
    public init(_ string: String) { stringValue = string; intValue = nil }
    public init?(stringValue: String) { self.stringValue = stringValue; intValue = nil }
    public init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}
