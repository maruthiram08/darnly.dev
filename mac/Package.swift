// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Darnly",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Darnly", targets: ["Darnly"]),
        .library(name: "DarnlyCore", targets: ["DarnlyCore"]),
    ],
    targets: [
        // Report writing, redaction and log parsing: no UI, fully unit tested.
        .target(name: "DarnlyCore"),
        // The menu bar app: hotkey, picker overlay, screenshot, note window.
        .executableTarget(name: "Darnly", dependencies: ["DarnlyCore"]),
        .testTarget(name: "DarnlyCoreTests", dependencies: ["DarnlyCore"]),
    ]
)
