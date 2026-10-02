import Foundation
import VatCore

/// Consumes feed updates for social features: friend online / ATC-opened notifications,
/// recording the user's own flights (badges) and leaderboard sync.
/// STUB — implemented by the Social module.
@MainActor
final class SocialCoordinator {
    weak var model: AppModel?

    init(model: AppModel) { self.model = model }

    func handle(_ update: FeedUpdate) {}
}
