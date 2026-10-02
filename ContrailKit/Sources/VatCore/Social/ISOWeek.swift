import Foundation

/// ISO-8601 week (Monday-based, week 1 contains the year's first Thursday), computed in UTC with pure
/// proleptic-Gregorian arithmetic (no `Calendar`, identical on every platform).
public struct ISOWeek: Codable, Sendable, Hashable, Comparable, CustomStringConvertible {
    public let year: Int
    public let week: Int

    /// Validating initialiser: `week` must exist in `year` (52 or 53 weeks).
    public init?(year: Int, week: Int) {
        guard week >= 1, week <= Self.weeksInYear(year) else { return nil }
        self.year = year
        self.week = week
    }

    public init(containing date: Date) {
        let days = Self.dayNumber(date)
        let weekday = Self.isoWeekday(days) // 1 = Monday … 7 = Sunday
        let thursday = days + (4 - weekday)
        let (y, _, _) = FastISO8601.civilFromDays(thursday)
        let jan1 = FastISO8601.daysFromCivil(year: y, month: 1, day: 1)
        year = y
        week = (thursday - jan1) / 7 + 1
    }

    /// Parses "2026-W40" (also "2026W40").
    public init?(id: String) {
        let s = id.uppercased().replacingOccurrences(of: "-", with: "")
        guard let w = s.firstIndex(of: "W"), let y = Int(s[..<w]), let wk = Int(s[s.index(after: w)...]) else {
            return nil
        }
        self.init(year: y, week: wk)
    }

    /// "2026-W40".
    public var id: String { "\(year)-W\(week < 10 ? "0" : "")\(week)" }
    public var description: String { id }

    /// Monday 00:00 UTC.
    public var start: Date { Date(timeIntervalSince1970: Double(Self.mondayOfWeek1(year) + (week - 1) * 7) * 86_400) }
    /// Next Monday 00:00 UTC (exclusive).
    public var end: Date { start.addingTimeInterval(7 * 86_400) }
    public var interval: DateInterval { DateInterval(start: start, end: end) }

    public var next: ISOWeek { ISOWeek(containing: end.addingTimeInterval(1)) }
    public var previous: ISOWeek { ISOWeek(containing: start.addingTimeInterval(-1)) }

    public func contains(_ date: Date) -> Bool { date >= start && date < end }

    public static func < (lhs: ISOWeek, rhs: ISOWeek) -> Bool { (lhs.year, lhs.week) < (rhs.year, rhs.week) }

    // MARK: Helpers

    static func dayNumber(_ date: Date) -> Int { Int((date.timeIntervalSince1970 / 86_400).rounded(.down)) }

    /// 1 = Monday … 7 = Sunday (1970-01-01 was a Thursday).
    static func isoWeekday(_ days: Int) -> Int { ((days + 3) % 7 + 7) % 7 + 1 }

    static func mondayOfWeek1(_ year: Int) -> Int {
        let jan4 = FastISO8601.daysFromCivil(year: year, month: 1, day: 4)
        return jan4 - (isoWeekday(jan4) - 1)
    }

    public static func weeksInYear(_ year: Int) -> Int {
        (mondayOfWeek1(year + 1) - mondayOfWeek1(year)) / 7
    }
}

/// UTC calendar helpers used by badges and challenges.
enum UTCCalendarDay {
    static func number(_ date: Date) -> Int { ISOWeek.dayNumber(date) }
    static func hour(_ date: Date) -> Int {
        let s = Int(date.timeIntervalSince1970.rounded(.down))
        return ((s % 86_400 + 86_400) % 86_400) / 3600
    }
    static func weekday(_ date: Date) -> Int { ISOWeek.isoWeekday(number(date)) }
    static func monthInterval(containing date: Date) -> DateInterval {
        let (y, m, _) = FastISO8601.civilFromDays(number(date))
        let start = FastISO8601.daysFromCivil(year: y, month: m, day: 1)
        let end = m == 12 ? FastISO8601.daysFromCivil(year: y + 1, month: 1, day: 1)
            : FastISO8601.daysFromCivil(year: y, month: m + 1, day: 1)
        return DateInterval(start: Date(timeIntervalSince1970: Double(start) * 86_400),
                            end: Date(timeIntervalSince1970: Double(end) * 86_400))
    }
}
