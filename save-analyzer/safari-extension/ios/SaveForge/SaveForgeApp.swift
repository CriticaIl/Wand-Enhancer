import SwiftUI

/// Container app for the SaveForge Trainer Safari Web Extension.
/// iOS requires every Safari extension to ship inside an app; this app only
/// explains how to switch the extension on.
@main
struct SaveForgeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
