import Foundation
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
import VatCore

// contrail-recorder: optional 24/7 recorder for the Contrail time machine (see Server/README.md).

let options: RecorderOptions
do {
    options = try RecorderOptions.parse(Array(CommandLine.arguments.dropFirst()))
} catch RecorderOptions.ParseError.help {
    print(RecorderOptions.usage)
    exit(0)
} catch {
    FileHandle.standardError.write(Data("\(error)\n\n\(RecorderOptions.usage)\n".utf8))
    exit(2)
}

let recorder = Recorder(options: options)

if options.once {
    do {
        let stored = try await recorder.cycle()
        if !stored { log("feed unchanged, nothing stored") }
        exit(0)
    } catch {
        log("error: \(error)")
        exit(1)
    }
}

// Graceful shutdown on SIGINT/SIGTERM: cancel the loop, let the current write finish.
let task = Task { await recorder.run() }
let signalSources = installSignalHandlers { [task] in task.cancel() }
await task.value
withExtendedLifetime(signalSources) {}
exit(0)
