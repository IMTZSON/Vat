import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Minimal HTTP transport used by every VatCore client. Implementations must not throw for
/// non-2xx status codes: the response is returned and the caller maps it to ``NetworkError``.
public protocol HTTPClient: Sendable {
    /// Performs `request` and returns the body and the HTTP response.
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// `URLSession`-backed ``HTTPClient`` with sensible timeouts and the Contrail `User-Agent`.
///
/// URL caching is disabled: conditional requests (`If-None-Match` / `If-Modified-Since`) and the
/// offline cache are handled explicitly by ``FeedService`` and ``ResponseCache``.
public final class URLSessionHTTPClient: HTTPClient {
    /// `User-Agent` sent with every request.
    public static let userAgent = "Contrail/1.0 (iOS; VATSIM client)"

    private let session: URLSession

    /// - Parameters:
    ///   - requestTimeout: Seconds without data before a request fails.
    ///   - resourceTimeout: Maximum total duration of a request.
    public init(requestTimeout: TimeInterval = 20, resourceTimeout: TimeInterval = 60) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpAdditionalHeaders = ["User-Agent": Self.userAgent]
        session = URLSession(configuration: configuration)
    }

    /// Wraps an existing session (e.g. a background or test session).
    public init(session: URLSession) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw NetworkError.invalidResponse }
            return (data, http)
        } catch let error as NetworkError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw NetworkError(urlError: error)
        } catch {
            throw NetworkError.transport(error.localizedDescription)
        }
    }
}

/// Programmable ``HTTPClient`` for unit tests and SwiftUI previews. Records every request.
public actor StubHTTPClient: HTTPClient {
    /// A canned response.
    public struct Response: Sendable {
        public var status: Int
        public var body: Data
        public var headers: [String: String]

        public init(status: Int = 200, body: Data = Data(), headers: [String: String] = [:]) {
            self.status = status
            self.body = body
            self.headers = headers
        }

        /// Response with a UTF-8 body.
        public static func text(_ string: String, status: Int = 200, headers: [String: String] = [:]) -> Response {
            Response(status: status, body: Data(string.utf8), headers: headers)
        }
    }

    public typealias Handler = @Sendable (URLRequest) async throws -> Response

    private var handler: Handler
    /// Requests received so far, in order.
    public private(set) var requests: [URLRequest] = []

    /// Answers every request through `handler` (throw a ``NetworkError`` to simulate failures).
    public init(handler: @escaping Handler) {
        self.handler = handler
    }

    /// Answers requests whose URL contains a key of `routes` with that response (longest key wins);
    /// other requests fail with ``NetworkError/offline``.
    public init(routes: [String: Response]) {
        self.handler = { request in
            let url = request.url?.absoluteString ?? ""
            for key in routes.keys.sorted(by: { $0.count > $1.count }) where url.contains(key) {
                if let response = routes[key] { return response }
            }
            throw NetworkError.offline
        }
    }

    /// Replaces the handler (e.g. to simulate going offline mid-test).
    public func setHandler(_ handler: @escaping Handler) {
        self.handler = handler
    }

    /// Number of requests whose URL contains `fragment`.
    public func requestCount(matching fragment: String) -> Int {
        requests.filter { $0.url?.absoluteString.contains(fragment) == true }.count
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let response = try await handler(request)
        guard let url = request.url,
              let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1",
                                         headerFields: response.headers)
        else { throw NetworkError.invalidResponse }
        return (response.body, http)
    }
}
