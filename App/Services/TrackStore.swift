import Foundation
import VatCore

/// In-memory breadcrumbs for every pilot seen since launch (flight trails, altitude/speed charts,
/// vertical rate for phase detection). Not observed: views re-read it when `AppModel.snapshotVersion`
/// changes. Memory is bounded (≤ 400 points per flight, older half downsampled).
final class TrackStore {
    private(set) var tracks: [String: FlightTrack] = [:]
    private var lastSeen: [String: Date] = [:]
    /// Pilots not seen for this long are forgotten.
    private let retention: TimeInterval = 30 * 60

    func track(for callsign: String) -> FlightTrack? { tracks[callsign] }

    func verticalRate(for callsign: String) -> Double? { tracks[callsign]?.verticalRateFpm() }

    func record(snapshot: NetworkSnapshot) {
        let now = snapshot.updatedAt ?? .now
        for pilot in snapshot.pilots {
            let time = pilot.lastUpdated ?? now
            var track = tracks[pilot.callsign] ?? FlightTrack(maxPoints: 400, minimumInterval: 30)
            // A reconnect far away (or a new flight) restarts the trail.
            if let last = track.last, last.position.distance(to: pilot.position) > 300 {
                track = FlightTrack(maxPoints: 400, minimumInterval: 30)
            }
            track.append(pilot: pilot, at: time)
            tracks[pilot.callsign] = track
            lastSeen[pilot.callsign] = now
        }
        let cutoff = now.addingTimeInterval(-retention)
        for (callsign, seen) in lastSeen where seen < cutoff {
            lastSeen[callsign] = nil
            tracks[callsign] = nil
        }
    }

    /// Seeds a trail (e.g. from time machine snapshots).
    func replace(_ track: FlightTrack, for callsign: String) {
        tracks[callsign] = track
        lastSeen[callsign] = track.last?.time ?? .now
    }
}
