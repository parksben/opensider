import AppKit
import Foundation

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let panel = NSOpenPanel()
panel.canChooseFiles = true
panel.canChooseDirectories = true
panel.allowsMultipleSelection = true
panel.canCreateDirectories = false
panel.resolvesAliases = true
panel.title = "Attach"
panel.prompt = "Select"
panel.message = "Choose files or folders"
panel.level = .modalPanel

NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
app.activate(ignoringOtherApps: true)

let response = panel.runModal()
if response == .OK {
  let text = panel.urls.map(\.path).joined(separator: "\n") + "\n"
  if let dest = CommandLine.arguments.dropFirst().first {
    try? text.write(toFile: dest, atomically: true, encoding: .utf8)
  } else {
    FileHandle.standardOutput.write(Data(text.utf8))
  }
}

exit(0)
