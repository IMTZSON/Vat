import Foundation
import SwiftData

/// Shared helpers to keep SwiftData favourites/friends and the `UserSettings` mirrors
/// (read by widgets and the watch) in sync. Use these instead of inserting models directly.
enum FavoritesStore {
    static func isFavorite(_ icao: String, settings: UserSettings) -> Bool {
        settings.favoriteAirports.contains(icao.uppercased())
    }

    static func toggleAirport(_ icao: String, context: ModelContext, settings: UserSettings) {
        let code = icao.uppercased()
        let existing = (try? context.fetch(FetchDescriptor<FavoriteAirport>(predicate: #Predicate { $0.icao == code }))) ?? []
        if existing.isEmpty {
            context.insert(FavoriteAirport(icao: code, sortIndex: settings.favoriteAirports.count))
            if !settings.favoriteAirports.contains(code) { settings.favoriteAirports.append(code) }
        } else {
            for item in existing { context.delete(item) }
            settings.favoriteAirports.removeAll { $0 == code }
        }
        try? context.save()
    }

    static func addFriend(cid: Int, nickname: String, context: ModelContext, settings: UserSettings) {
        let existing = (try? context.fetch(FetchDescriptor<Friend>(predicate: #Predicate { $0.cid == cid }))) ?? []
        if let friend = existing.first {
            friend.nickname = nickname
        } else {
            context.insert(Friend(cid: cid, nickname: nickname))
        }
        if !settings.friendCIDs.contains(cid) { settings.friendCIDs.append(cid) }
        try? context.save()
    }

    static func removeFriend(cid: Int, context: ModelContext, settings: UserSettings) {
        let existing = (try? context.fetch(FetchDescriptor<Friend>(predicate: #Predicate { $0.cid == cid }))) ?? []
        for item in existing { context.delete(item) }
        settings.friendCIDs.removeAll { $0 == cid }
        try? context.save()
    }

    /// Re-aligns the settings mirrors with SwiftData (e.g. after a CloudKit sync from another device).
    static func syncMirrors(context: ModelContext, settings: UserSettings) {
        let airports = ((try? context.fetch(FetchDescriptor<FavoriteAirport>(sortBy: [SortDescriptor(\.sortIndex)]))) ?? []).map(\.icao)
        let friends = ((try? context.fetch(FetchDescriptor<Friend>())) ?? []).map(\.cid)
        var seenA = Set<String>(), seenF = Set<Int>()
        let a = airports.filter { seenA.insert($0).inserted }
        let f = friends.filter { seenF.insert($0).inserted }
        if !a.isEmpty, a != settings.favoriteAirports { settings.favoriteAirports = a }
        if !f.isEmpty, f != settings.friendCIDs { settings.friendCIDs = f }
    }
}
