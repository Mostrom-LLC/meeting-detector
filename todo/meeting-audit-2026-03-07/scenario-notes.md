# Meeting Detector Audit Notes (2026-03-07)

## Environment
- Host: macOS (local workspace)
- Detector harness: `node scripts/meeting-audit-runner.mjs --dedupe-ms 60000 --debug true`
- Detector events file: `todo/meeting-audit-2026-03-07/events.ndjson`
- Raw TCC stream predicate: `subsystem == "com.apple.TCC" AND (eventMessage CONTAINS[c] "kTCCServiceMicrophone" OR eventMessage CONTAINS[c] "kTCCServiceCamera")`

## Scenarios

### 1) Baseline non-meeting camera event: Photo Booth
- Start: 2026-03-07T15:46Z
- Action: Open Photo Booth app, wait, quit
- Raw TCC: camera+microphone Granting events present
- Detector output: no `meeting_signal` emitted
- Preliminary result: likely false negative due parser not handling `Granting ... pid=...` pattern

