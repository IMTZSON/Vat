import Foundation
import Observation
import ContrailShared

/// User preferences shared with widgets (App Group defaults) and synced across the user's devices,
/// including Apple Watch, through the iCloud key-value store.
@Observable
final class UserSettings {
    /// The user's own VATSIM CID (onboarding step 1). 0 = not set.
    var cid: Int { didSet { write(SharedKeys.userCID, cid) } }
    /// Favourite airport ICAO codes, mirrored from SwiftData for widgets and the watch.
    var favoriteAirports: [String] { didSet { write(SharedKeys.favoriteAirports, favoriteAirports) } }
    /// Followed friends' CIDs, mirrored from SwiftData for widgets and the watch.
    var friendCIDs: [Int] { didSet { write(SharedKeys.friendCIDs, friendCIDs) } }
    /// Followed flight callsigns.
    var followedCallsigns: [String] { didSet { write(SharedKeys.followedCallsigns, followedCallsigns) } }
    var simbriefUsername: String { didSet { write(SharedKeys.simbriefUsername, simbriefUsername) } }

    // Local-only preferences
    var hasCompletedOnboarding: Bool { didSet { local.set(hasCompletedOnboarding, forKey: "hasCompletedOnboarding") } }
    var notificationsEnabled: Bool { didSet { local.set(notificationsEnabled, forKey: "notificationsEnabled") } }
    var recordTimeMachine: Bool { didSet { local.set(recordTimeMachine, forKey: "recordTimeMachine") } }
    var timeMachineRetentionDays: Int { didSet { local.set(timeMachineRetentionDays, forKey: "timeMachineRetentionDays") } }
    /// Optional URL of a self-hosted snapshot recorder (Server/README.md).
    var recorderServerURL: String { didSet { local.set(recorderServerURL, forKey: "recorderServerURL") } }
    /// Display name for public leaderboards (optional, D-021).
    var leaderboardName: String { didSet { local.set(leaderboardName, forKey: "leaderboardName") } }
    var shareOnLeaderboard: Bool { didSet { local.set(shareOnLeaderboard, forKey: "shareOnLeaderboard") } }

    @ObservationIgnored private let shared: UserDefaults
    @ObservationIgnored private let local: UserDefaults
    @ObservationIgnored private let cloud = NSUbiquitousKeyValueStore.default
    @ObservationIgnored private var observer: NSObjectProtocol?
    @ObservationIgnored private var isApplyingCloud = false

    init(shared: UserDefaults = SharedStore.defaults, local: UserDefaults = .standard) {
        self.shared = shared
        self.local = local
        cid = shared.integer(forKey: SharedKeys.userCID)
        favoriteAirports = shared.stringArray(forKey: SharedKeys.favoriteAirports) ?? []
        friendCIDs = (shared.array(forKey: SharedKeys.friendCIDs) as? [Int]) ?? []
        followedCallsigns = shared.stringArray(forKey: SharedKeys.followedCallsigns) ?? []
        simbriefUsername = shared.string(forKey: SharedKeys.simbriefUsername) ?? ""
        hasCompletedOnboarding = local.bool(forKey: "hasCompletedOnboarding")
        notificationsEnabled = local.bool(forKey: "notificationsEnabled")
        recordTimeMachine = local.object(forKey: "recordTimeMachine") as? Bool ?? true
        timeMachineRetentionDays = local.object(forKey: "timeMachineRetentionDays") as? Int ?? 7
        recorderServerURL = local.string(forKey: "recorderServerURL") ?? ""
        leaderboardName = local.string(forKey: "leaderboardName") ?? ""
        shareOnLeaderboard = local.bool(forKey: "shareOnLeaderboard")

        observer = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: cloud, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyCloudValues() }
        }
        cloud.synchronize()
        applyCloudValues()
    }

    private func write(_ key: String, _ value: Any) {
        shared.set(value, forKey: key)
        guard !isApplyingCloud else { return }
        cloud.set(value, forKey: key)
    }

    /// Pulls values changed on another device (iPhone ↔ iPad ↔ Watch).
    private func applyCloudValues() {
        isApplyingCloud = true
        defer { isApplyingCloud = false }
        if let v = cloud.object(forKey: SharedKeys.userCID) as? Int, v != 0, v != cid { cid = v }
        if let v = cloud.array(forKey: SharedKeys.favoriteAirports) as? [String], v != favoriteAirports { favoriteAirports = v }
        if let v = cloud.array(forKey: SharedKeys.friendCIDs) as? [Int], v != friendCIDs { friendCIDs = v }
        if let v = cloud.array(forKey: SharedKeys.followedCallsigns) as? [String], v != followedCallsigns { followedCallsigns = v }
        if let v = cloud.string(forKey: SharedKeys.simbriefUsername), v != simbriefUsername { simbriefUsername = v }
    }
}
