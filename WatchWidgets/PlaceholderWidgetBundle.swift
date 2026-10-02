import SwiftUI
import WidgetKit

// Temporary placeholder so the target links until the Widgets module lands. Removed at integration.
@main
struct PlaceholderWidgetBundle: WidgetBundle {
    var body: some Widget { PlaceholderWidget() }
}

struct PlaceholderWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "placeholder", provider: PlaceholderProvider()) { _ in Text("Contrail") }
    }
}

struct PlaceholderProvider: TimelineProvider {
    struct Entry: TimelineEntry { var date: Date }
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}
