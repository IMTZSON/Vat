import Foundation
import VatCore

/// Aviation-style formatting shared by app, widgets and watch. Numbers are locale-aware.
public enum AviationFormat {
    /// "FL350" above the transition (18,000 ft), "3,500 ft" below.
    public static func altitude(_ feet: Int, transition: Int = 18_000) -> String {
        if feet >= transition {
            let fl = Int((Double(feet) / 100).rounded())
            return "FL" + String(format: "%03d", fl)
        }
        return feet.formatted(.number.grouping(.automatic)) + " ft"
    }

    public static func speed(_ knots: Int) -> String { "\(knots) kt" }

    public static func distance(_ nm: Double) -> String {
        nm < 10 ? String(format: "%.1f NM", nm) : "\(Int(nm.rounded()).formatted()) NM"
    }

    public static func heading(_ degrees: Int) -> String { String(format: "%03d°", (degrees % 360 + 360) % 360) }

    /// "Z" time, e.g. "18:45Z".
    public static func zulu(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02dZ", c.hour ?? 0, c.minute ?? 0)
    }

    /// Local short time, e.g. "20:45".
    public static func localTime(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// Compact duration "1 h 25 min" / "25 min".
    public static func duration(_ interval: TimeInterval) -> String {
        let minutes = max(0, Int((interval / 60).rounded()))
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m) min" }
        return m == 0 ? "\(h) h" : "\(h) h \(m) min"
    }

    /// Hours as "123.4 h".
    public static func hours(_ h: Double) -> String {
        h.formatted(.number.precision(.fractionLength(h < 100 ? 1 : 0))) + " h"
    }

    /// "118.700" → "118.700" (always three decimals), invalid → "—".
    public static func frequency(_ mhz: String) -> String {
        guard let v = Double(mhz) else { return "—" }
        return String(format: "%.3f", v)
    }
}
