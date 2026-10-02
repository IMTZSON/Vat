import SwiftUI
import ContrailShared
import VatCore

// MARK: - Status

/// Coloured pill showing a coverage state (green online / amber booked / grey offline).
struct CoveragePill: View {
    var state: CoverageState
    var text: String?

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Theme.color(for: state))
                .frame(width: 7, height: 7)
            Text(text ?? state.localizedTitle)
                .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Theme.color(for: state).opacity(0.16), in: Capsule())
        .foregroundStyle(Theme.color(for: state))
        .accessibilityElement(children: .combine)
    }
}

extension CoverageState {
    var localizedTitle: String {
        switch self {
        case .online: String(localized: "Online")
        case .booked: String(localized: "Booked")
        case .offline: String(localized: "Offline")
        }
    }
}

/// Chip for an ATC position ("TWR", "APP"…), coloured by state.
struct PositionChip: View {
    var position: ATCPosition
    var state: CoverageState = .online
    var detail: String?

    var body: some View {
        HStack(spacing: 4) {
            Text(position.rawValue)
                .font(.caption.weight(.bold))
            if let detail {
                Text(detail)
                    .font(.caption2)
                    .numericStyle(.caption2, weight: .medium)
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Theme.color(for: state).opacity(state == .offline ? 0.12 : 0.22), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .foregroundStyle(state == .offline ? Theme.offline : Theme.color(for: state))
        .accessibilityLabel(Text("\(position.rawValue) \(state.localizedTitle)"))
    }
}

/// Pulsing dot used for "live" indicators.
struct LiveDot: View {
    var color: Color = Theme.online
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle().fill(color.opacity(0.35)).frame(width: 14, height: 14)
                .scaleEffect(pulse ? 1.4 : 0.8)
                .opacity(pulse ? 0 : 1)
            Circle().fill(color).frame(width: 7, height: 7)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Metrics

/// Big rounded number with a caption, e.g. "FL350 / Altitude".
struct MetricTile: View {
    var title: LocalizedStringKey
    var value: String
    var systemImage: String?
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if let systemImage { Image(systemName: systemImage).imageScale(.small) }
                Text(title)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            Text(value)
                .numericStyle(.title3, weight: .semibold)
                .foregroundStyle(tint)
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Section header with optional trailing accessory.
struct SectionHeader<Trailing: View>: View {
    var title: LocalizedStringKey
    var systemImage: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Label {
                Text(title).font(.headline)
            } icon: {
                if let systemImage { Image(systemName: systemImage).foregroundStyle(Theme.cyan) }
            }
            Spacer()
            trailing
        }
        .padding(.top, Theme.Spacing.s)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: LocalizedStringKey, systemImage: String? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.trailing = EmptyView()
    }
}

// MARK: - Loading, empty, error

/// Shimmering placeholder modifier for skeleton loading.
struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .redacted(reason: .placeholder)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, .white.opacity(0.25), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: phase * geo.size.width * 1.6)
                    }
                    .mask(content.redacted(reason: .placeholder))
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1 }
            }
            .accessibilityLabel(Text("Loading"))
    }
}

extension View {
    func shimmering(_ active: Bool = true) -> some View {
        Group {
            if active { modifier(Shimmer()) } else { self }
        }
    }
}

/// Generic skeleton list rows.
struct SkeletonRows: View {
    var count = 6

    var body: some View {
        VStack(spacing: Theme.Spacing.m) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(spacing: Theme.Spacing.m) {
                    RoundedRectangle(cornerRadius: 8).frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Placeholder title text").font(.headline)
                        Text("Secondary placeholder line").font(.subheadline)
                    }
                    Spacer()
                }
            }
        }
        .padding()
        .shimmering()
    }
}

/// Empty state wrapper around `ContentUnavailableView`.
struct EmptyStateView: View {
    var title: LocalizedStringKey
    var systemImage: String
    var message: LocalizedStringKey?
    var actionTitle: LocalizedStringKey?
    var action: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.cyan)
        } description: {
            if let message { Text(message) }
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.cyan)
            }
        }
    }
}

/// Error state with retry.
struct ErrorStateView: View {
    var error: Error
    var retry: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "exclamationmark.triangle")
                .foregroundStyle(Theme.amber)
        } description: {
            Text(error.localizedDescription)
        } actions: {
            if let retry {
                Button("Try again", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.cyan)
            }
        }
    }
}

/// Small banner shown on top of the map when data is stale / offline.
struct StatusBanner: View {
    enum Kind { case offline, stale, info }
    var kind: Kind
    var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(text).font(.footnote.weight(.medium)).lineLimit(2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .foregroundStyle(color)
        .glassCard(cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch kind {
        case .offline: "wifi.slash"
        case .stale: "clock.badge.exclamationmark"
        case .info: "info.circle"
        }
    }

    private var color: Color {
        switch kind {
        case .offline: Theme.danger
        case .stale: Theme.amber
        case .info: Theme.cyan
        }
    }
}

// MARK: - Haptics

enum Haptics {
    static func selection() {
        #if os(iOS)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
    }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: style).impactOccurred()
        #endif
    }

    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }
}

// MARK: - Misc

/// Aircraft glyph rotated to heading.
struct AircraftGlyph: View {
    var heading: Int
    var altitudeFt: Int
    var size: CGFloat = 18
    var highlighted = false

    var body: some View {
        Image(systemName: "airplane")
            .font(.system(size: size, weight: .semibold))
            .rotationEffect(.degrees(Double(heading) - 90))
            .foregroundStyle(highlighted ? Theme.amber : Theme.altitudeColor(altitudeFt))
            .shadow(color: .black.opacity(0.5), radius: 1.5)
            .accessibilityHidden(true)
    }
}

/// Departure → arrival header ("LIRF ✈︎ EGLL").
struct RouteHeader: View {
    var departure: String
    var arrival: String
    var progress: Double?

    var body: some View {
        HStack(spacing: Theme.Spacing.s) {
            Text(departure.isEmpty ? "—" : departure).numericStyle(.title2, weight: .bold)
            ZStack {
                Capsule().fill(.secondary.opacity(0.25)).frame(height: 3)
                if let progress {
                    GeometryReader { geo in
                        Capsule().fill(Theme.cyan)
                            .frame(width: max(3, geo.size.width * progress), height: 3)
                            .frame(maxHeight: .infinity, alignment: .center)
                        Image(systemName: "airplane")
                            .font(.caption)
                            .foregroundStyle(Theme.cyan)
                            .position(x: max(8, min(geo.size.width - 8, geo.size.width * progress)), y: geo.size.height / 2)
                    }
                } else {
                    Image(systemName: "airplane").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(height: 20)
            Text(arrival.isEmpty ? "—" : arrival).numericStyle(.title2, weight: .bold)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("From \(departure) to \(arrival)"))
    }
}
