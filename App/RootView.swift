import SwiftUI
import ContrailShared

/// Root tab bar: Map, Airports, Events, Friends, Profile. Sidebar-adaptable on iPad and Mac.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(UserSettings.self) private var settings

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Map", systemImage: "map.fill", value: AppTab.map) {
                MapScreen()
            }
            Tab("Airports", systemImage: "airplane.departure", value: AppTab.airports) {
                AirportsScreen()
            }
            Tab("Events", systemImage: "calendar", value: AppTab.events) {
                EventsScreen()
            }
            Tab("Friends", systemImage: "person.2.fill", value: AppTab.friends) {
                FriendsScreen()
            }
            Tab("Profile", systemImage: "person.crop.circle", value: AppTab.profile) {
                ProfileScreen()
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .sheet(item: $model.presentedSheet) { sheet in
            AppSheetView(sheet: sheet)
        }
        .fullScreenCover(isPresented: Binding(
            get: { !settings.hasCompletedOnboarding },
            set: { if !$0 { settings.hasCompletedOnboarding = true } }
        )) {
            OnboardingView()
        }
    }
}

/// Resolves global sheets to their screens.
struct AppSheetView: View {
    var sheet: AppSheet

    var body: some View {
        switch sheet {
        case .onboarding: OnboardingView()
        case .assistant: AssistantEntryView()
        case .timeMachine: TimeMachineView()
        case .info: NavigationStack { InfoView() }
        case .simBrief: NavigationStack { FlightPlanningView() }
        case .tonight: NavigationStack { TonightView() }
        case .bookings: NavigationStack { BookingsCalendarView() }
        case .settings: NavigationStack { SettingsView() }
        }
    }
}
