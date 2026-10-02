import Foundation
import Observation
import SwiftUI
import VatCore

/// Tabs of the root `TabView`.
enum AppTab: String, Hashable, CaseIterable {
    case map, airports, events, friends, profile
}

/// A request for the map to move/select something (from search, events, airports, friends…).
/// Each request has a unique id so repeating the same target re-triggers the camera move.
struct MapCommand: Equatable, Identifiable {
    enum Target: Equatable {
        case pilot(callsign: String)
        case airport(icao: String)
        case sector(id: String)
        case region(GeoBounds)
        case event(id: Int, airports: [String])
        /// Shows a planned route (e.g. imported from SimBrief) on the map.
        case route(waypoints: [Waypoint])
    }

    let id = UUID()
    var target: Target
}

/// Connection state of the live feed, shown as a banner on the map.
enum FeedState: Equatable {
    case idle
    case loading
    case live(updatedAt: Date)
    /// Showing cached data because the latest refresh failed.
    case stale(since: Date, message: String)
    case offline(message: String)
}

/// Root observable state of the app (MVVM: feature view models read from it and call its actions).
@Observable
final class AppModel {
    // MARK: Dependencies

    let services: AppServices
    let settings: UserSettings

    // MARK: Reference data

    private(set) var reference: ReferenceData?
    private(set) var referenceError: String?

    // MARK: Live data

    /// Latest live snapshot (nil until the first load / cache read).
    private(set) var liveSnapshot: NetworkSnapshot?
    /// Last diff applied, consumed by the map for differential annotation updates.
    private(set) var lastDiff: FeedDiff?
    /// Increments on every new snapshot (cheap change token for views).
    private(set) var snapshotVersion = 0
    private(set) var feedState: FeedState = .idle
    private(set) var activeSectors: [ActiveSector] = []
    private(set) var airportStatus: [String: AirportATCStatus] = [:]

    private(set) var bookings: [ATCBooking] = []
    private(set) var bookingsUpdatedAt: Date?
    private(set) var bookingsError: String?
    private(set) var events: [VatsimEvent] = []
    private(set) var eventsUpdatedAt: Date?
    private(set) var eventsError: String?

    /// Flight tracks (breadcrumbs) recorded since launch, per callsign.
    let tracks = TrackStore()

    // MARK: Time machine

    /// When set, the map shows this historical snapshot instead of live data.
    var replaySnapshot: NetworkSnapshot?
    var isReplaying: Bool { replaySnapshot != nil }

    /// What the map and lists should display: replay if active, otherwise live data.
    var displayedSnapshot: NetworkSnapshot? { replaySnapshot ?? liveSnapshot }

    // MARK: Navigation

    var selectedTab: AppTab = .map
    var mapCommand: MapCommand?
    var presentedSheet: AppSheet?

    // MARK: Coordinators (feed consumers)

    @ObservationIgnored lazy var social = SocialCoordinator(model: self)
    @ObservationIgnored lazy var liveActivities = LiveActivityCoordinator(model: self)
    @ObservationIgnored lazy var widgets = WidgetCoordinator(model: self)
    @ObservationIgnored lazy var timeMachine = TimeMachineRecorder(model: self)

    @ObservationIgnored private var feedTask: Task<Void, Never>?
    @ObservationIgnored private var referenceTask: Task<Void, Never>?

    init(services: AppServices = .live(), settings: UserSettings = UserSettings()) {
        self.services = services
        self.settings = settings
    }

    // MARK: Lifecycle

    /// Loads reference data and the cached feed, then starts live polling. Idempotent.
    func start() {
        loadReferenceIfNeeded()
        guard feedTask == nil else { return }
        if liveSnapshot == nil { feedState = .loading }
        let feed = services.feed
        feedTask = Task { [weak self] in
            if let cached = await feed.cachedFeed() {
                self?.apply(cached, fromCache: true)
            }
            for await result in feed.updates() {
                guard let self, !Task.isCancelled else { break }
                switch result {
                case .success(let update):
                    self.apply(update, fromCache: update.isFromCache)
                case .failure(let error, let lastGood):
                    if self.liveSnapshot == nil, let lastGood { self.apply(lastGood, fromCache: true) }
                    self.markFailure(error)
                }
            }
        }
        Task { await refreshBookings() }
        Task { await refreshEvents() }
    }

    /// Stops polling (app in background). Background refresh uses `refreshOnce()` instead.
    func stop() {
        feedTask?.cancel()
        feedTask = nil
    }

    /// Single refresh used by background tasks and pull-to-refresh.
    func refreshOnce() async {
        loadReferenceIfNeeded()
        do {
            let update = try await services.feed.fetch()
            apply(update, fromCache: false)
        } catch let error as NetworkError {
            markFailure(error)
        } catch {
            markFailure(.transport(error.localizedDescription))
        }
    }

    func refreshBookings(force: Bool = false) async {
        do {
            let fetched = try await services.bookings.bookings()
            bookings = fetched.value.sorted { $0.start < $1.start }
            bookingsUpdatedAt = fetched.fetchedAt
            bookingsError = fetched.isStale ? fetched.error?.localizedDescription : nil
            rebuildSectors()
        } catch {
            bookingsError = error.localizedDescription
        }
    }

    func refreshEvents(force: Bool = false) async {
        do {
            let fetched = try await services.events.events()
            events = fetched.value
            eventsUpdatedAt = fetched.fetchedAt
            eventsError = fetched.isStale ? fetched.error?.localizedDescription : nil
        } catch {
            eventsError = error.localizedDescription
        }
    }

    private func loadReferenceIfNeeded() {
        guard reference == nil, referenceTask == nil else { return }
        let mapData = services.mapData
        referenceTask = Task { [weak self] in
            let files = await mapData.currentFiles()
            let loaded = await Task.detached(priority: .userInitiated) { () -> Result<ReferenceData, Error> in
                Result { try ReferenceData.load(files: files) }
            }.value
            guard let self else { return }
            switch loaded {
            case .success(let data):
                self.reference = data
                self.rebuildSectors()
            case .failure(let error):
                // Downloaded files may be corrupt: fall back to the bundle.
                if let bundled = try? await Task.detached(priority: .userInitiated, operation: {
                    try ReferenceData.load(files: BundledData.mapFiles)
                }).value {
                    self.reference = bundled
                    self.rebuildSectors()
                } else {
                    self.referenceError = error.localizedDescription
                }
            }
            // Daily update of VATSpy / SimAware data; applied on next launch if it changed.
            _ = await mapData.refreshIfNeeded(force: false)
        }
    }

    // MARK: Feed handling

    private func apply(_ update: FeedUpdate, fromCache: Bool) {
        let snapshot = update.snapshot
        if !update.isFresh, liveSnapshot != nil, !fromCache { return }
        liveSnapshot = snapshot
        lastDiff = update.diff
        snapshotVersion &+= 1
        if fromCache {
            feedState = .stale(since: snapshot.updatedAt ?? update.fetchedAt,
                               message: String(localized: "Showing cached data"))
        } else {
            feedState = .live(updatedAt: snapshot.updatedAt ?? update.fetchedAt)
        }
        tracks.record(snapshot: snapshot)
        rebuildSectors()
        guard !fromCache else { return }
        social.handle(update)
        liveActivities.handle(update)
        widgets.handle(update)
        timeMachine.handle(update)
    }

    private func markFailure(_ error: NetworkError) {
        if let snapshot = liveSnapshot {
            feedState = .stale(since: snapshot.updatedAt ?? .now, message: error.localizedDescription)
        } else {
            feedState = .offline(message: error.localizedDescription)
        }
    }

    private func rebuildSectors() {
        guard let reference, let snapshot = displayedSnapshot else { return }
        let result = reference.activeSectorsBuilder.build(snapshot: snapshot, bookings: bookings, now: .now)
        activeSectors = result.sectors
        airportStatus = result.airports
    }

    /// Recomputes sectors for the replay snapshot (called by the time machine when scrubbing).
    func replayDidChange() {
        snapshotVersion &+= 1
        lastDiff = nil
        rebuildSectors()
    }

    // MARK: Navigation helpers

    /// Switches to the map tab and focuses a target.
    func showOnMap(_ target: MapCommand.Target) {
        selectedTab = .map
        mapCommand = MapCommand(target: target)
    }

    // MARK: Following flights

    /// Followed flights drive the Live Activity, widgets and the watch. Source of truth: `settings.followedCallsigns`.
    func isFollowing(_ callsign: String) -> Bool { settings.followedCallsigns.contains(callsign) }

    func toggleFollow(_ callsign: String) {
        if let index = settings.followedCallsigns.firstIndex(of: callsign) {
            settings.followedCallsigns.remove(at: index)
            liveActivities.stop(callsign: callsign)
        } else {
            settings.followedCallsigns.append(callsign)
            liveActivities.start(callsign: callsign)
        }
        widgets.refresh()
    }

    // MARK: Convenience queries

    func pilot(callsign: String) -> Pilot? { displayedSnapshot?.pilot(callsign: callsign) }

    func airport(_ icao: String) -> Airport? { reference?.airports.airport(icao: icao) }

    /// Online friends (CIDs from settings) currently connected as pilot, controller or ATIS.
    var onlineFriendCIDs: Set<Int> {
        guard let snapshot = liveSnapshot else { return [] }
        return Set(settings.friendCIDs.filter { snapshot.isOnline(cid: $0) })
    }
}

// MARK: - Previews

extension AppModel {
    /// A model with sample traffic and no network access, for SwiftUI previews.
    static func preview() -> AppModel {
        let model = AppModel(services: .preview(), settings: UserSettings(shared: UserDefaults(suiteName: "preview") ?? .standard,
                                                                         local: UserDefaults(suiteName: "preview") ?? .standard))
        model.injectPreview(snapshot: NetworkSnapshot(feed: PreviewData.feed))
        return model
    }

    /// Replaces the live snapshot (previews and UI tests only).
    func injectPreview(snapshot: NetworkSnapshot) {
        liveSnapshot = snapshot
        snapshotVersion &+= 1
        feedState = .live(updatedAt: .now)
        tracks.record(snapshot: snapshot)
        events = PreviewData.events
        bookings = PreviewData.bookings
    }
}

/// Modal sheets presented from anywhere (settings, tools…).
enum AppSheet: String, Identifiable {
    case onboarding, assistant, timeMachine, info, simBrief, tonight, bookings, settings
    var id: String { rawValue }
}
