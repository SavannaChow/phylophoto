// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhyloPhotoStandalone",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "PhyloPhoto", targets: ["PhyloPhotoStandalone"])],
    targets: [
        .executableTarget(
            name: "PhyloPhotoStandalone",
            resources: [.process("Resources")]
        )
    ]
)
