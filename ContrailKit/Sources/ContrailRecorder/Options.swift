import Foundation

/// Command-line options of `contrail-recorder`.
struct RecorderOptions: Sendable {
    static let minimumInterval: TimeInterval = 15

    var output: URL
    var interval: TimeInterval = 15
    var retentionDays: Int = 7
    var once = false
    var statusURL = URL(string: "https://status.vatsim.net/status.json")!
    var fallbackFeedURL = URL(string: "https://data.vatsim.net/v3/vatsim-data.json")!
    var feedURLOverride: URL?

    static let usage = """
    contrail-recorder — records the VATSIM network every 15 s as compact snapshots (no names, DECISIONS D-020).

    USAGE: contrail-recorder --output <dir> [--interval <seconds>] [--retention-days <days>] [--once]
                             [--status-url <url>] [--feed-url <url>]

    OPTIONS:
      --output <dir>           Snapshot directory (created if missing). Serve it with any static HTTP server.
      --interval <seconds>     Polling interval, never below 15 (default 15).
      --retention-days <days>  Days of history to keep, 1…30 (default 7).
      --once                   Fetch and store a single snapshot, then exit.
      --status-url <url>       VATSIM status document (default https://status.vatsim.net/status.json).
      --feed-url <url>         Skip discovery and use this data feed URL.
      -h, --help               Show this help.
    """

    enum ParseError: Error, CustomStringConvertible {
        case missing(String)
        case invalid(String, String)
        case unknown(String)
        case help

        var description: String {
            switch self {
            case .missing(let o): "Missing required option \(o)"
            case .invalid(let o, let v): "Invalid value '\(v)' for \(o)"
            case .unknown(let o): "Unknown option \(o)"
            case .help: RecorderOptions.usage
            }
        }
    }

    static func parse(_ arguments: [String]) throws -> RecorderOptions {
        var output: URL?
        var options = RecorderOptions(output: URL(fileURLWithPath: "."))
        var i = 0
        func value(_ name: String) throws -> String {
            i += 1
            guard i < arguments.count else { throw ParseError.missing("value for \(name)") }
            return arguments[i]
        }
        while i < arguments.count {
            let arg = arguments[i]
            switch arg {
            case "--output", "-o":
                output = URL(fileURLWithPath: try value(arg), isDirectory: true)
            case "--interval":
                let v = try value(arg)
                guard let s = Double(v), s.isFinite, s > 0 else { throw ParseError.invalid(arg, v) }
                options.interval = max(minimumInterval, s)
            case "--retention-days":
                let v = try value(arg)
                guard let d = Int(v), d > 0 else { throw ParseError.invalid(arg, v) }
                options.retentionDays = min(30, d)
            case "--once":
                options.once = true
            case "--status-url":
                let v = try value(arg)
                guard let u = URL(string: v) else { throw ParseError.invalid(arg, v) }
                options.statusURL = u
            case "--feed-url":
                let v = try value(arg)
                guard let u = URL(string: v) else { throw ParseError.invalid(arg, v) }
                options.feedURLOverride = u
            case "-h", "--help":
                throw ParseError.help
            default:
                throw ParseError.unknown(arg)
            }
            i += 1
        }
        guard let output else { throw ParseError.missing("--output") }
        options.output = output
        return options
    }
}
