import Foundation
import VatCore

/// Records compact feed snapshots locally for the time machine.
/// STUB — implemented by the Time Machine module.
@MainActor
final class TimeMachineRecorder {
    weak var model: AppModel?

    init(model: AppModel) { self.model = model }

    func handle(_ update: FeedUpdate) {}
}
