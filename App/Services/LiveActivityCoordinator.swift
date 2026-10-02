import Foundation
import VatCore

/// Starts/updates/ends Live Activities for followed flights from feed updates.
/// STUB — implemented by the Widgets/Live Activity module.
@MainActor
final class LiveActivityCoordinator {
    weak var model: AppModel?

    init(model: AppModel) { self.model = model }

    func handle(_ update: FeedUpdate) {}

    /// Starts a Live Activity for a followed flight (if allowed and the flight is online).
    func start(callsign: String) {}

    /// Ends the Live Activity of a flight that is no longer followed.
    func stop(callsign: String) {}
}
