import Foundation

/// Allocation-free parser for the timestamp formats used by VATSIM services.
///
/// Supported:
/// - `2026-10-02T09:15:42.1234567Z` (any number of fractional digits, `Z` or `±HH:MM` offset)
/// - `2026-10-02T09:15:42Z`, `2026-10-02T09:15Z`
/// - `2026-10-02 09:15:42` (booking API, interpreted as UTC)
///
/// `ISO8601DateFormatter` rejects 7 fractional digits on some platforms and is slow for thousands of
/// records per feed, hence this parser.
public enum FastISO8601 {
    public static func parse(_ string: String) -> Date? {
        var utf8 = Array(string.utf8)
        // Trim whitespace.
        while let last = utf8.last, last == 0x20 || last == 0x0A || last == 0x0D { utf8.removeLast() }
        guard utf8.count >= 16 else { return nil }
        var i = 0

        func digits(_ n: Int) -> Int? {
            guard i + n <= utf8.count else { return nil }
            var value = 0
            for k in 0..<n {
                let c = utf8[i + k]
                guard c >= 0x30 && c <= 0x39 else { return nil }
                value = value * 10 + Int(c - 0x30)
            }
            i += n
            return value
        }
        func expect(_ chars: [UInt8]) -> Bool {
            guard i < utf8.count, chars.contains(utf8[i]) else { return false }
            i += 1
            return true
        }

        guard let year = digits(4), expect([0x2D]),
              let month = digits(2), expect([0x2D]),
              let day = digits(2), expect([0x54, 0x20, 0x74]), // T, space, t
              let hour = digits(2), expect([0x3A]),
              let minute = digits(2)
        else { return nil }

        var second = 0
        var fraction = 0.0
        if i < utf8.count, utf8[i] == 0x3A {
            i += 1
            guard let s = digits(2) else { return nil }
            second = s
            if i < utf8.count, utf8[i] == 0x2E || utf8[i] == 0x2C {
                i += 1
                var scale = 0.1
                while i < utf8.count, utf8[i] >= 0x30, utf8[i] <= 0x39 {
                    fraction += Double(utf8[i] - 0x30) * scale
                    scale /= 10
                    i += 1
                }
            }
        }

        var offsetSeconds = 0
        if i < utf8.count {
            let c = utf8[i]
            if c == 0x5A || c == 0x7A { // Z
                i += 1
            } else if c == 0x2B || c == 0x2D { // + -
                let sign = c == 0x2B ? 1 : -1
                i += 1
                guard let oh = digits(2) else { return nil }
                if i < utf8.count, utf8[i] == 0x3A { i += 1 }
                let om = digits(2) ?? 0
                offsetSeconds = sign * (oh * 3600 + om * 60)
            }
        }
        guard i == utf8.count else { return nil }
        guard (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60, second < 61 else { return nil }

        let days = daysFromCivil(year: year, month: month, day: day)
        let seconds = Double(days * 86_400 + hour * 3600 + minute * 60 + second - offsetSeconds) + fraction
        return Date(timeIntervalSince1970: seconds)
    }

    /// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
    static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// Formats as `yyyy-MM-dd'T'HH:mm:ss'Z'` (UTC).
    public static func string(from date: Date) -> String {
        let total = Int(date.timeIntervalSince1970.rounded(.down))
        var days = total / 86_400
        var rem = total % 86_400
        if rem < 0 { rem += 86_400; days -= 1 }
        let (y, m, d) = civilFromDays(days)
        func pad(_ v: Int, _ n: Int = 2) -> String {
            let s = String(v)
            return String(repeating: "0", count: max(0, n - s.count)) + s
        }
        return "\(pad(y, 4))-\(pad(m))-\(pad(d))T\(pad(rem / 3600)):\(pad(rem % 3600 / 60)):\(pad(rem % 60))Z"
    }

    static func civilFromDays(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }
}
