# MOS-74: Rust Core Implementation Spec

## Overview
Rewrite the meeting-detector core in Rust using napi-rs for Node.js bindings.

## Architecture

```
native/
├── Cargo.toml
├── build.rs
├── src/
│   ├── lib.rs           # napi-rs exports
│   ├── detector.rs      # Platform-agnostic state machine
│   ├── types.rs         # MeetingPlatform, MeetingState, DetectorError
│   ├── matchers/
│   │   ├── mod.rs       # Matcher trait + registry
│   │   ├── zoom.rs
│   │   ├── teams.rs
│   │   ├── meet.rs
│   │   ├── slack.rs
│   │   └── generic.rs   # Fallback matchers
│   └── platform/
│       ├── mod.rs       # PlatformDetector trait
│       ├── macos.rs     # TCC + NSWorkspace + AudioObject
│       ├── windows.rs   # WASAPI + UI Automation
│       └── linux.rs     # PulseAudio + X11
└── index.d.ts           # Generated TypeScript definitions
```

## Phase 1: MOS-75 - Project Setup (Current)

### Deliverables
1. `Cargo.toml` with napi-rs dependencies
2. Basic type definitions matching TypeScript types
3. Platform detection trait stub
4. Build configuration for cross-compilation
5. npm scripts for native build

### Types to Port

```rust
pub enum MeetingPlatform {
    MicrosoftTeams,
    Zoom,
    GoogleMeet,
    Slack,
    CiscoWebex,
    Discord,
    FaceTime,
    Skype,
    Whereby,
    GoToMeeting,
    BlueJeans,
    JitsiMeet,
    EightByEight,
    RingCentral,
    BigBlueButton,
    AmazonChime,
    GoogleHangouts,
    AdobeConnect,
    TeamViewer,
    AnyDesk,
    ClickMeeting,
    AppearIn,
    Unknown,
}

pub struct MeetingSignal {
    pub event: String,
    pub timestamp: String,
    pub service: String,
    pub verdict: String,
    pub preflight: bool,
    pub process: String,
    pub pid: String,
    pub parent_pid: String,
    pub process_path: String,
    pub front_app: String,
    pub window_title: String,
    pub session_id: String,
    pub camera_active: bool,
    pub chrome_url: Option<String>,
}

pub struct MeetingLifecycleEvent {
    pub event: String,  // meeting_started | meeting_changed | meeting_ended
    pub timestamp: String,
    pub platform: MeetingPlatform,
    pub previous_platform: Option<MeetingPlatform>,
    pub confidence: String,  // high | medium | low
    pub reason: String,      // signal | switch | timeout | stop
}

pub enum DetectorError {
    PermissionDenied { reason: String },
    PlatformNotSupported,
    ApiUnavailable { api: String },
    ParseError { message: String },
}
```

### Build Configuration
- Target: Node.js 18+
- Platforms: macOS (universal), Windows x64, Linux x64
- napi-rs version: 2.x

## Test Plan (TDD)

### Unit Tests (Phase 1)
1. Type serialization/deserialization
2. Platform enum string conversion
3. Error type creation

### Integration Tests (Later Phases)
- Platform detection on each OS
- Event emission through napi-rs
- Memory leak detection

## Success Criteria
- `cargo check` passes
- `npm run build:native` compiles successfully
- TypeScript types generated correctly
- Basic smoke test passes
