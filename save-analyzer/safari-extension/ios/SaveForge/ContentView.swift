import SwiftUI

struct ContentView: View {
    private let steps: [(String, String)] = [
        ("1", "Open the Settings app → Safari → Extensions → SaveForge Trainer, and turn it on."),
        ("2", "Leave “All Websites” on Ask (recommended). SaveForge only needs a page when you tap it."),
        ("3", "In Safari, open a browser game, tap the “AA” (or puzzle-piece) button in the address bar, then tap SaveForge Trainer."),
        ("4", "When Safari asks, allow access for this website. The floating trainer appears over the game."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    Image(systemName: "hexagon.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(LinearGradient(colors: [Color(red: 0.24, green: 0.96, blue: 0.65), Color(red: 0.13, green: 0.83, blue: 0.93)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    VStack(alignment: .leading) {
                        Text("SaveForge Trainer").font(.title.bold().italic())
                        Text("Safari extension").foregroundStyle(.secondary)
                    }
                }
                Text("Open a floating, GTA-style trainer over browser games. It edits supported engines live (RPG Maker, SugarCube, Construct 2, plain HTML5 globals) and saves in browser storage with Apply & Reload. Every option has an ⓘ explanation.")
                ForEach(steps, id: \.0) { step in
                    HStack(alignment: .top, spacing: 12) {
                        Text(step.0).font(.headline).frame(width: 28, height: 28).background(Circle().fill(Color.accentColor.opacity(0.2)))
                        Text(step.1)
                    }
                }
                Text("Privacy: the extension has no access to any website until you tap it, and then only to that tab. Nothing is uploaded.")
                    .font(.footnote).foregroundStyle(.secondary)
                Link("Open the SaveForge web app", destination: URL(string: "https://criticail.github.io/Wand-Enhancer/save-analyzer/standalone/SaveForge.html")!)
                    .font(.headline)
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
