import Foundation

/// A volume with its current staffing.
public struct ActiveSector: Sendable, Hashable, Identifiable {
    public var volume: AirspaceVolume
    /// Controllers staffing the volume (sorted by callsign).
    public var controllers: [Controller]
    /// ATIS stations of the airport (airport volumes only).
    public var atis: [Controller]
    /// `.online` when staffed, `.booked` when only a booking covers it.
    public var state: CoverageState
    /// The relevant booking (active now or starting soon), if any.
    public var booking: ATCBooking?

    public var id: String { volume.id }

    public init(volume: AirspaceVolume, controllers: [Controller] = [], atis: [Controller] = [],
                state: CoverageState, booking: ATCBooking? = nil) {
        self.volume = volume
        self.controllers = controllers
        self.atis = atis
        self.state = state
        self.booking = booking
    }
}

/// ATC summary of one airport (for map badges and the airport screen).
public struct AirportATCStatus: Sendable, Hashable, Identifiable {
    public var icao: String
    /// Positions online among DEL, GND, TWR, APP/DEP, ATIS.
    public var online: Set<ATCPosition>
    /// Positions booked (active now or within the look-ahead) but not online.
    public var booked: Set<ATCPosition>
    public var controllers: [Controller]
    public var atis: [Controller]
    public var bookings: [ATCBooking]

    public var id: String { icao }

    public init(icao: String, online: Set<ATCPosition> = [], booked: Set<ATCPosition> = [], controllers: [Controller] = [],
                atis: [Controller] = [], bookings: [ATCBooking] = []) {
        self.icao = icao
        self.online = online
        self.booked = booked
        self.controllers = controllers
        self.atis = atis
        self.bookings = bookings
    }

    /// Current ATIS letter (first station with a code).
    public var atisCode: String? { atis.lazy.compactMap(\.atisCode).first { !$0.isEmpty } }

    public var state: CoverageState {
        if !online.subtracting([.atis]).isEmpty { return .online }
        if !booked.isEmpty { return .booked }
        return online.isEmpty ? .offline : .online
    }

    /// Online positions in display order (DEL, GND, TWR, APP, DEP, ATIS last).
    public var onlineSorted: [ATCPosition] { online.sorted { ($0 == .atis ? 9 : $0.rank) < ($1 == .atis ? 9 : $1.rank) } }
}

/// Combined output of ``ActiveSectorsBuilder/build(snapshot:bookings:now:)``.
public struct ActiveSectorsResult: Sendable {
    public var sectors: [ActiveSector]
    /// Keyed by airport ICAO.
    public var airports: [String: AirportATCStatus]

    public init(sectors: [ActiveSector] = [], airports: [String: AirportATCStatus] = [:]) {
        self.sectors = sectors
        self.airports = airports
    }

    public static let empty = ActiveSectorsResult()
}

/// Maps online controllers and bookings onto airspace volumes and airports.
public struct ActiveSectorsBuilder: Sendable {
    public let sectors: SectorDatabase
    /// A booking counts as "booked" from this long before its start.
    public var bookingLookahead: TimeInterval
    /// When true (default), controllers not on a real frequency (199.998) are ignored.
    public var requireFrequency: Bool

    public init(sectors: SectorDatabase, bookingLookahead: TimeInterval = 3600, requireFrequency: Bool = true) {
        self.sectors = sectors
        self.bookingLookahead = bookingLookahead
        self.requireFrequency = requireFrequency
    }

    /// Sectors and airport statuses from a feed snapshot.
    public func build(snapshot: NetworkSnapshot, bookings: [ATCBooking] = [], now: Date = Date()) -> ActiveSectorsResult {
        build(controllers: snapshot.controllers, atis: snapshot.atis, bookings: bookings, now: now)
    }

    /// Sectors and airport statuses from explicit lists.
    public func build(controllers: [Controller], atis: [Controller], bookings: [ATCBooking] = [],
                      now: Date = Date()) -> ActiveSectorsResult {
        ActiveSectorsResult(sectors: activeSectors(controllers: controllers, atis: atis, bookings: bookings, now: now),
                            airports: airportStatuses(controllers: controllers, atis: atis, bookings: bookings, now: now))
    }

    /// Online and booked sectors, online first, then by kind (FIR/UIR, TRACON, airport) and id.
    public func activeSectors(controllers: [Controller], atis: [Controller], bookings: [ATCBooking] = [],
                              now: Date = Date()) -> [ActiveSector] {
        var byID: [String: ActiveSector] = [:]
        for controller in controllers where isStaffing(controller) {
            for volume in sectors.volumes(for: controller) {
                byID[volume.id, default: ActiveSector(volume: volume, state: .online)].controllers.append(controller)
            }
        }
        // ATIS: its own (radius 0) airport volume, and attached to the airport's other local sectors.
        var atisByAirport: [String: [Controller]] = [:]
        for station in atis {
            for volume in sectors.volumes(for: station) {
                byID[volume.id, default: ActiveSector(volume: volume, state: .online)].atis.append(station)
                if let icao = volume.callsignPrefixes.first { atisByAirport[icao, default: []].append(station) }
            }
        }
        for (id, sector) in byID where sector.volume.kind == .airport && !id.hasSuffix(":ATIS") {
            if let icao = sector.volume.callsignPrefixes.first, let stations = atisByAirport[icao] {
                byID[id]?.atis = stations
            }
        }
        for booking in relevant(bookings, now: now) {
            for volume in sectors.volumes(forCallsign: booking.callsign) {
                if var existing = byID[volume.id] {
                    if existing.booking == nil { existing.booking = booking }
                    byID[volume.id] = existing
                } else {
                    byID[volume.id] = ActiveSector(volume: volume, state: .booked, booking: booking)
                }
            }
        }
        return byID.values.map { sector in
            var s = sector
            s.controllers.sort { $0.callsign < $1.callsign }
            s.atis.sort { $0.callsign < $1.callsign }
            return s
        }.sorted { a, b in
            if a.state != b.state { return a.state > b.state }
            let ka = Self.kindOrder(a.volume.kind), kb = Self.kindOrder(b.volume.kind)
            if ka != kb { return ka < kb }
            return a.id < b.id
        }
    }

    /// Per-airport status for airports with any local/approach controller, ATIS or booking.
    public func airportStatuses(controllers: [Controller], atis: [Controller], bookings: [ATCBooking] = [],
                                now: Date = Date()) -> [String: AirportATCStatus] {
        var result: [String: AirportATCStatus] = [:]
        let local: Set<ATCPosition> = [.delivery, .ground, .tower, .approach, .departure]
        for controller in controllers where isStaffing(controller) && local.contains(controller.position) {
            guard let airport = sectors.airport(forCallsign: controller.callsign) else { continue }
            var status = result[airport.icao] ?? AirportATCStatus(icao: airport.icao)
            status.online.insert(controller.position)
            status.controllers.append(controller)
            result[airport.icao] = status
        }
        for station in atis {
            guard let airport = sectors.airport(forCallsign: station.callsign) else { continue }
            var status = result[airport.icao] ?? AirportATCStatus(icao: airport.icao)
            status.online.insert(.atis)
            status.atis.append(station)
            result[airport.icao] = status
        }
        for booking in relevant(bookings, now: now) {
            let position = ATCPosition(callsign: booking.callsign, facility: .observer)
            guard local.contains(position) || position == .atis,
                  let airport = sectors.airport(forCallsign: booking.callsign) else { continue }
            var status = result[airport.icao] ?? AirportATCStatus(icao: airport.icao)
            if !status.online.contains(position) { status.booked.insert(position) }
            status.bookings.append(booking)
            result[airport.icao] = status
        }
        for key in result.keys {
            result[key]?.controllers.sort { ($0.position, $0.callsign) < ($1.position, $1.callsign) }
            result[key]?.atis.sort { $0.callsign < $1.callsign }
            result[key]?.bookings.sort { $0.start < $1.start }
        }
        return result
    }

    // MARK: - Private

    private func isStaffing(_ controller: Controller) -> Bool {
        let position = controller.position
        guard position != .observer, position != .supervisor else { return false }
        return !requireFrequency || controller.isOnFrequency
    }

    private func relevant(_ bookings: [ATCBooking], now: Date) -> [ATCBooking] {
        let horizon = now.addingTimeInterval(bookingLookahead)
        return bookings.filter { $0.isActive(at: now) || ($0.start > now && $0.start <= horizon) }
            .sorted { $0.start < $1.start }
    }

    static func kindOrder(_ kind: AirspaceVolume.Kind) -> Int {
        switch kind {
        case .uir: 0
        case .fir: 1
        case .tracon: 2
        case .airport: 3
        }
    }
}
