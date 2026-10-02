import SwiftUI
import VatCore

/// Contrail design tokens: night-aviation palette with cyan and amber accents.
/// Coverage states are consistent everywhere: green = ATC online, amber = booked, grey = offline.
public enum Theme {
    // MARK: Palette

    /// Deep night background (#0A1020).
    public static let night = Color(red: 10 / 255, green: 16 / 255, blue: 32 / 255)
    /// Slightly lifted surface for cards on the night background (#131C33).
    public static let nightElevated = Color(red: 19 / 255, green: 28 / 255, blue: 51 / 255)
    /// Primary accent, cyan (#3FD8F2).
    public static let cyan = Color(red: 63 / 255, green: 216 / 255, blue: 242 / 255)
    /// Secondary accent, amber (#FFB547).
    public static let amber = Color(red: 255 / 255, green: 181 / 255, blue: 71 / 255)
    /// ATC online (#34D399).
    public static let online = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)
    /// ATC booked — amber.
    public static let booked = amber
    /// Offline / unavailable (#8A94A6).
    public static let offline = Color(red: 138 / 255, green: 148 / 255, blue: 166 / 255)
    /// Errors and warnings (#FF6B6B).
    public static let danger = Color(red: 255 / 255, green: 107 / 255, blue: 107 / 255)

    /// Adaptive accent: darker cyan on light backgrounds for contrast.
    public static let accent = Color("AccentColor")

    public static func color(for state: CoverageState) -> Color {
        switch state {
        case .online: online
        case .booked: booked
        case .offline: offline
        }
    }

    public static func symbol(for state: CoverageState) -> String {
        switch state {
        case .online: "dot.radiowaves.left.and.right"
        case .booked: "calendar.badge.clock"
        case .offline: "antenna.radiowaves.left.and.right.slash"
        }
    }

    // MARK: Altitude scale

    /// Altitude colour stops (feet → colour), used for aircraft icons, trails and charts.
    public static let altitudeStops: [(feet: Double, rgb: (Double, Double, Double))] = [
        (0, (0.60, 0.65, 0.69)),       // ground – grey
        (1_000, (0.24, 0.86, 0.59)),   // low – green
        (10_000, (0.25, 0.85, 0.95)),  // cyan
        (25_000, (0.36, 0.55, 1.00)),  // blue
        (35_000, (0.69, 0.49, 1.00)),  // violet
        (45_000, (1.00, 0.48, 0.85)),  // pink
    ]

    /// Interpolated colour components for an altitude in feet.
    public static func altitudeRGB(_ feet: Double) -> (red: Double, green: Double, blue: Double) {
        let stops = altitudeStops
        guard let first = stops.first, let last = stops.last else { return (1, 1, 1) }
        if feet <= first.feet { return first.rgb }
        if feet >= last.feet { return last.rgb }
        for (a, b) in zip(stops, stops.dropFirst()) where feet <= b.feet {
            let t = (feet - a.feet) / (b.feet - a.feet)
            return (a.rgb.0 + (b.rgb.0 - a.rgb.0) * t,
                    a.rgb.1 + (b.rgb.1 - a.rgb.1) * t,
                    a.rgb.2 + (b.rgb.2 - a.rgb.2) * t)
        }
        return last.rgb
    }

    public static func altitudeColor(_ feet: Int) -> Color {
        let c = altitudeRGB(Double(feet))
        return Color(red: c.red, green: c.green, blue: c.blue)
    }

    /// Colour per ATC position, used for sector fills and chips.
    public static func color(for position: ATCPosition) -> Color {
        switch position {
        case .center, .flightService: cyan
        case .approach, .departure: Color(red: 0.36, green: 0.55, blue: 1.0)
        case .tower: Color(red: 1.0, green: 0.42, blue: 0.42)
        case .ground: Color(red: 0.24, green: 0.86, blue: 0.59)
        case .delivery: Color(red: 0.55, green: 0.80, blue: 1.0)
        case .atis: amber
        case .observer, .supervisor: offline
        }
    }

    // MARK: Layout

    public enum Radius {
        public static let small: CGFloat = 10
        public static let medium: CGFloat = 16
        public static let large: CGFloat = 24
        public static let sheet: CGFloat = 32
    }

    public enum Spacing {
        public static let xs: CGFloat = 4
        public static let s: CGFloat = 8
        public static let m: CGFloat = 12
        public static let l: CGFloat = 16
        public static let xl: CGFloat = 24
    }

    // MARK: Motion

    /// Default spring for UI transitions.
    public static var spring: Animation { .spring(response: 0.42, dampingFraction: 0.82) }
    public static var snappy: Animation { .spring(response: 0.28, dampingFraction: 0.86) }
}

// MARK: - Typography

public extension View {
    /// SF Pro Rounded, monospaced digits — used for every number in the app.
    func numericStyle(_ style: Font.TextStyle = .body, weight: Font.Weight = .semibold) -> some View {
        font(.system(style, design: .rounded, weight: weight)).monospacedDigit()
    }
}

public extension Font {
    static func rounded(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .system(style, design: .rounded, weight: weight)
    }
}
