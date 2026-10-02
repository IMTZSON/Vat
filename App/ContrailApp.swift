import SwiftUI
import SwiftData
import VatCore
import ContrailShared

@main
struct ContrailApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    private let container = PersistenceController.makeContainer()

    init() {
        BackgroundRefresh.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.settings)
                .modelContainer(container)
                .tint(Theme.cyan)
                .task { model.start() }
                .onOpenURL { url in DeepLink.handle(url, model: model) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                model.start()
            case .background:
                model.stop()
                BackgroundRefresh.schedule()
            default:
                break
            }
        }
    }
}

/// `contrail://flight/AZA123`, `contrail://airport/LIRF`, `contrail://event/123` (widgets, Live Activity, share cards).
enum DeepLink {
    static func handle(_ url: URL, model: AppModel) {
        guard url.scheme == "contrail" else { return }
        let value = url.pathComponents.dropFirst().first ?? ""
        switch url.host() {
        case "flight":
            model.showOnMap(.pilot(callsign: value.uppercased()))
        case "airport":
            model.showOnMap(.airport(icao: value.uppercased()))
        case "event":
            model.selectedTab = .events
        case "friends":
            model.selectedTab = .friends
        default:
            break
        }
    }

    static func flight(_ callsign: String) -> URL { URL(string: "contrail://flight/\(callsign)")! }
    static func airport(_ icao: String) -> URL { URL(string: "contrail://airport/\(icao)")! }
}
