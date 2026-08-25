import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
  let dest: String?

  init(dest: String?) {
    self.dest = dest
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let logPath = home + "/.cursor-sidebar/host.log"
    let stamp = ISO8601DateFormatter().string(from: Date())
    if let handle = FileHandle(forWritingAtPath: logPath) {
      handle.seekToEndOfFile()
      handle.write(Data("[\(stamp)] pick-files launched dest=\(dest ?? "-")\n".utf8))
      handle.closeFile()
    }

    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])

    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = true
    panel.canCreateDirectories = false
    panel.resolvesAliases = true
    panel.title = "Attach"
    panel.prompt = "Select"
    panel.message = "Choose files or folders"
    panel.level = .floating
    panel.center()

    let response = panel.runModal()
    if response == .OK {
      let text = panel.urls.map(\.path).joined(separator: "\n") + "\n"
      if let dest {
        try? text.write(toFile: dest, atomically: true, encoding: .utf8)
      } else {
        FileHandle.standardOutput.write(Data(text.utf8))
      }
    }
    NSApp.terminate(nil)
  }
}

let dest = CommandLine.arguments.dropFirst().first
let app = NSApplication.shared
let delegate = AppDelegate(dest: dest)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
