import Foundation
import SwiftData
import VatCore

// SwiftData models (cache + favourites). All properties have defaults and there are no unique
// constraints so the store can sync through the user's private CloudKit database (DECISIONS D-021).

/// A favourite airport (onboarding step 2, airport tab star).
@Model
final class FavoriteAirport {
    var icao: String = ""
    var addedAt: Date = Date.now
    /// Notify when ATC opens here.
    var notifyATC: Bool = true
    var sortIndex: Int = 0

    init(icao: String, notifyATC: Bool = true, sortIndex: Int = 0) {
        self.icao = icao.uppercased()
        self.notifyATC = notifyATC
        self.sortIndex = sortIndex
        self.addedAt = .now
    }
}

/// A followed VATSIM member.
@Model
final class Friend {
    var cid: Int = 0
    /// Nickname chosen by the user (real names are not stored, D-020).
    var nickname: String = ""
    var addedAt: Date = Date.now
    var notifyOnline: Bool = true
    var lastSeenOnline: Date?
    var lastCallsign: String?

    init(cid: Int, nickname: String = "", notifyOnline: Bool = true) {
        self.cid = cid
        self.nickname = nickname
        self.notifyOnline = notifyOnline
        self.addedAt = .now
    }

    var displayName: String { nickname.isEmpty ? "CID \(cid)" : nickname }
}

/// A flight of the user's own CID observed in the feed (badge input, D-016).
/// The full `FlightRecord` is stored as JSON to keep the schema stable while the logic evolves.
@Model
final class StoredFlightRecord {
    var recordID: String = ""
    var cid: Int = 0
    var callsign: String = ""
    var departure: String = ""
    var arrival: String = ""
    var firstSeen: Date = Date.now
    var lastSeen: Date = Date.now
    var completed: Bool = false
    var payload: Data = Data()

    init(recordID: String, cid: Int, callsign: String, departure: String, arrival: String,
         firstSeen: Date, lastSeen: Date, completed: Bool, payload: Data) {
        self.recordID = recordID
        self.cid = cid
        self.callsign = callsign
        self.departure = departure
        self.arrival = arrival
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen
        self.completed = completed
        self.payload = payload
    }
}

/// A badge earned by the user, kept to notify only once and to show the earned date.
@Model
final class EarnedBadge {
    var badgeID: String = ""
    var earnedAt: Date = Date.now
    var notified: Bool = false

    init(badgeID: String, earnedAt: Date) {
        self.badgeID = badgeID
        self.earnedAt = earnedAt
    }
}

/// Imported SimBrief OFP (latest few), stored as raw JSON.
@Model
final class SavedFlightPlan {
    var importedAt: Date = Date.now
    var callsign: String = ""
    var origin: String = ""
    var destination: String = ""
    var payload: Data = Data()

    init(callsign: String, origin: String, destination: String, payload: Data) {
        self.callsign = callsign
        self.origin = origin
        self.destination = destination
        self.payload = payload
        self.importedAt = .now
    }
}

enum PersistenceController {
    static let schema = Schema([
        FavoriteAirport.self, Friend.self, StoredFlightRecord.self, EarnedBadge.self,
        SavedFlightPlan.self,
    ])

    /// CloudKit-backed container when iCloud is available, otherwise local; in-memory as last resort.
    static func makeContainer(inMemory: Bool = false) -> ModelContainer {
        if inMemory {
            let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            return try! ModelContainer(for: schema, configurations: [config]) // swiftlint:disable:this force_try
        }
        let cloud = ModelConfiguration(schema: schema, cloudKitDatabase: .private("iCloud.info.everyapp.contrail"))
        if let container = try? ModelContainer(for: schema, configurations: [cloud]) {
            return container
        }
        let local = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
        if let container = try? ModelContainer(for: schema, configurations: [local]) {
            return container
        }
        let memory = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        return try! ModelContainer(for: schema, configurations: [memory]) // swiftlint:disable:this force_try
    }
}
