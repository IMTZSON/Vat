// swift-tools-version: 6.0
import PackageDescription

// VatCore is Foundation-only and builds on Linux (CI + optional recorder server).
// ContrailShared contains Apple-only code (SwiftUI tokens, ActivityKit attributes, App Group store)
// shared by the app, widget extension and watch app; it is only added when building on Apple platforms.

var products: [Product] = [
    .library(name: "VatCore", targets: ["VatCore"]),
    .executable(name: "contrail-recorder", targets: ["ContrailRecorder"]),
]

var targets: [Target] = [
    .target(
        name: "VatCore",
        path: "Sources/VatCore"
    ),
    .executableTarget(
        name: "ContrailRecorder",
        dependencies: ["VatCore"],
        path: "Sources/ContrailRecorder"
    ),
    .testTarget(
        name: "VatCoreTests",
        dependencies: ["VatCore"],
        path: "Tests/VatCoreTests",
        resources: [.copy("Fixtures")]
    ),
]

#if os(macOS)
products.append(.library(name: "ContrailShared", targets: ["ContrailShared"]))
targets.append(
    .target(
        name: "ContrailShared",
        dependencies: ["VatCore"],
        path: "Sources/ContrailShared"
    )
)
#endif

let package = Package(
    name: "ContrailKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v18), .watchOS(.v11), .macOS(.v15)],
    products: products,
    targets: targets,
    swiftLanguageModes: [.v6]
)
