import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors surfaced by VatCore network clients.
public enum NetworkError: Error, Sendable, Equatable, LocalizedError {
    /// No connection, DNS failure, timeout or connection lost.
    case offline
    /// The server answered with a non-success HTTP status.
    case http(status: Int)
    /// The payload could not be decoded.
    case decoding(String)
    /// HTTP 429 or a client-side rate limit; `retryAfter` in seconds when known.
    case rateLimited(retryAfter: TimeInterval?)
    /// The response was not an HTTP response or was otherwise unusable.
    case invalidResponse
    /// Any other transport-level failure.
    case transport(String)

    init(urlError: URLError) {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .callIsActive:
            self = .offline
        case .badServerResponse, .cannotParseResponse, .cannotDecodeRawData, .cannotDecodeContentData:
            self = .invalidResponse
        default:
            self = .transport(urlError.localizedDescription)
        }
    }

    public var errorDescription: String? {
        switch self {
        case .offline:
            "You appear to be offline."
        case let .http(status):
            "The server responded with an error (HTTP \(status))."
        case let .decoding(detail):
            "The data received could not be read (\(detail))."
        case let .rateLimited(retryAfter):
            if let retryAfter {
                "Too many requests. Try again in \(Int(retryAfter.rounded(.up))) s."
            } else {
                "Too many requests. Try again shortly."
            }
        case .invalidResponse:
            "The server sent an invalid response."
        case let .transport(detail):
            "The request failed: \(detail)"
        }
    }

    /// True when cached data may be served instead (connectivity or server-side problems).
    public var allowsStaleFallback: Bool {
        switch self {
        case .offline, .rateLimited, .invalidResponse, .transport: true
        case let .http(status): status >= 500 || status == 408
        case .decoding: false
        }
    }

    /// Validates an HTTP status, mapping failures to ``NetworkError``. 2xx and 304 pass.
    static func check(_ response: HTTPURLResponse) throws {
        switch response.statusCode {
        case 200..<300, 304: return
        case 429: throw NetworkError.rateLimited(retryAfter: retryAfter(response))
        default: throw NetworkError.http(status: response.statusCode)
        }
    }

    static func retryAfter(_ response: HTTPURLResponse) -> TimeInterval? {
        guard let value = response.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespaces)
        else { return nil }
        return TimeInterval(value)
    }

    /// Maps any error to a ``NetworkError``.
    static func wrap(_ error: Error) -> NetworkError {
        if let error = error as? NetworkError { return error }
        if let error = error as? URLError { return NetworkError(urlError: error) }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .transport(String(describing: error))
    }
}
