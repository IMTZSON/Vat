import SwiftUI
import ContrailShared

// Glass / blur surfaces. On iOS 26 the Liquid Glass `glassEffect` is used; earlier systems fall back
// to `.ultraThinMaterial` with a hairline border, which looks consistent on the night map.

struct GlassBackground: ViewModifier {
    var cornerRadius: CGFloat = Theme.Radius.large
    var interactive = false

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(interactive ? .regular.interactive() : .regular, in: .rect(cornerRadius: cornerRadius))
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(.white.opacity(0.12), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.25), radius: 16, y: 6)
        }
    }
}

extension View {
    /// Glass surface with rounded corners.
    func glassCard(cornerRadius: CGFloat = Theme.Radius.large, interactive: Bool = false) -> some View {
        modifier(GlassBackground(cornerRadius: cornerRadius, interactive: interactive))
    }

    /// Circular glass button background (map controls).
    func glassCircle() -> some View {
        frame(width: 44, height: 44)
            .modifier(GlassBackground(cornerRadius: 22, interactive: true))
    }

    /// Applies the sheet background used by map bottom sheets.
    @ViewBuilder
    func glassSheetBackground() -> some View {
        if #available(iOS 26.0, *) {
            self // iOS 26 sheets are Liquid Glass by default.
        } else {
            presentationBackground(.ultraThinMaterial)
        }
    }
}

/// A padded card on a glass surface.
struct GlassCard<Content: View>: View {
    var padding: CGFloat = Theme.Spacing.l
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard()
    }
}

/// Plain elevated card for lists on the night background.
struct SurfaceCard<Content: View>: View {
    var padding: CGFloat = Theme.Spacing.l
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
    }
}
