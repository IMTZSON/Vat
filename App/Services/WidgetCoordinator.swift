import Foundation
import VatCore

/// Writes the App Group `WidgetSnapshot` and reloads widget timelines / syncs the watch.
/// STUB — implemented by the Widgets/Watch module.
@MainActor
final class WidgetCoordinator {
    weak var model: AppModel?

    init(model: AppModel) { self.model = model }

    func handle(_ update: FeedUpdate) {}
}
