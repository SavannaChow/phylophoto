// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhyloAtlasStandalone",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "PhyloAtlas", targets: ["PhyloPhotoStandalone"])],
    targets: [
        .executableTarget(
            name: "PhyloPhotoStandalone",
            resources: [.process("Resources")]
        )
    ]
)
