// archive-watcher: uploads the dSYMs of every new Xcode archive via upload-dsyms.sh.
// Usage: archive-watcher <path/to/upload-dsyms.sh>

import CoreServices
import Foundation

// ARCHIVES_DIR exists for tests, the LaunchAgent watches Xcode's default folder
let archivesPath = ProcessInfo.processInfo.environment["ARCHIVES_DIR"] ?? ("~/Library/Developer/Xcode/Archives" as NSString).expandingTildeInPath
let uploader = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let uploads = DispatchQueue(label: "uploads")
var seen = Set<String>()

func log(_ message: String) {
    print("\(ISO8601DateFormatter().string(from: Date())) \(message)")
    fflush(stdout)
}

func upload(_ archive: String) {
    uploads.async {
        // FSEvents can report the same Info.plist several times while Xcode finishes the archive
        guard !seen.contains(archive) else { return }
        seen.insert(archive)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [uploader, archive]
        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus != 0 { seen.remove(archive) }
        } catch {
            seen.remove(archive)
            log("error: \(error)")
        }
    }
}

// Xcode writes the archive's Info.plist last, so its creation marks a finished archive
let callback: FSEventStreamCallback = { _, _, count, paths, _, _ in
    guard let list = unsafeBitCast(paths, to: NSArray.self) as? [String] else { return }
    for path in list.prefix(count) where path.hasSuffix(".xcarchive/Info.plist") {
        upload((path as NSString).deletingLastPathComponent)
    }
}

guard FileManager.default.isExecutableFile(atPath: uploader) || FileManager.default.fileExists(atPath: uploader) else {
    log("error: upload script not found at \(uploader)")
    exit(1)
}

var context = FSEventStreamContext()
let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)
guard let stream = FSEventStreamCreate(nil, callback, &context, [archivesPath] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 1.0, flags) else {
    log("error: cannot watch \(archivesPath)")
    exit(1)
}
FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
FSEventStreamStart(stream)
log("watching \(archivesPath)")
dispatchMain()
