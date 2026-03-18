# MOS-112: Split Native and Web Meeting Detection

## Overview

Refactor the meeting detector to separate native desktop meeting detection from browser/web meeting detection, unified behind an arbitration layer that produces lifecycle events.

**Issue:** https://linear.app/mostrom/issue/MOS-112
**Branch:** `feature/MOS-112`
**Repo:** https://github.com/Mostrom-LLC/meeting-detector

## Problem

Live testing showed mixed-path contamination:
- Google Meet web detection flapped repeatedly with Microsoft Teams
- Browser hints interfered with native app detection
- Single-path heuristics caused regressions when fixing one platform

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MeetingDetector (Public API)                  │
│  - start(), stop(), isRunning()                                  │
│  - onMeeting(), onMeetingStarted(), onMeetingChanged(), etc.    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Arbitration Layer                            │
│  - Receives candidates from both engines                         │
│  - Applies precedence rules (native vs web)                      │
│  - Suppresses stale/conflicting signals                          │
│  - Emits: meeting_started, meeting_changed, meeting_ended        │
└─────────────────────────────────────────────────────────────────┘
          │                                           │
          ▼                                           ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│   Native Detector Engine  │         │    Web Detector Engine   │
│                          │         │                          │
│  Signals:                │         │  Signals:                │
│  - Process detection     │         │  - Browser tab URL       │
│  - Window titles         │         │  - Tab title             │
│  - Native media state    │         │  - Browser media state   │
│  - TCC mic/camera signals│         │  - Browser meeting hints │
│                          │         │                          │
│  Platforms:              │         │  Platforms:              │
│  - Microsoft Teams native│         │  - Google Meet           │
│  - Zoom native           │         │  - Zoom web              │
│  - Slack native/huddles  │         │  - Microsoft Teams web   │
│  - Discord               │         │  - Slack web huddles     │
│  - FaceTime              │         │  - Cisco Webex web       │
│  - Cisco Webex native    │         │  - Jitsi Meet            │
│                          │         │  - etc.                  │
│  Output:                 │         │  Output:                 │
│  - NativeMeetingCandidate│         │  - WebMeetingCandidate   │
└──────────────────────────┘         └──────────────────────────┘
```

## File Structure

```
src/
├── types.ts                     # Existing + new candidate types
├── index.ts                     # Public API (unchanged)
├── detector.ts                  # Refactored to use engines + arbitration
├── native-bridge.ts             # Existing Rust bridge
├── engines/
│   ├── index.ts                 # Engine exports
│   ├── types.ts                 # Engine-specific types
│   ├── native-engine.ts         # Native detector engine
│   └── web-engine.ts            # Web detector engine
├── arbitration/
│   ├── index.ts                 # Arbitration exports
│   ├── types.ts                 # Arbitration types
│   ├── arbitrator.ts            # Main arbitration logic
│   └── rules.ts                 # Precedence and suppression rules
└── matchers/
    ├── index.ts                 # Matcher exports
    ├── browser-url.ts           # URL matching (extracted)
    └── process-name.ts          # Process matching (extracted)
```

## Phase 1: Separate Responsibilities

### 1.1 Define Engine Types (`src/engines/types.ts`)

```typescript
export interface MeetingCandidate {
  platform: MeetingPlatform;
  confidence: 'high' | 'medium' | 'low';
  source: 'native' | 'web';
  timestamp: number;
  evidence: MeetingEvidence;
}

export interface NativeMeetingCandidate extends MeetingCandidate {
  source: 'native';
  evidence: NativeEvidence;
}

export interface WebMeetingCandidate extends MeetingCandidate {
  source: 'web';
  evidence: WebEvidence;
}

export interface NativeEvidence {
  processName: string;
  processPath?: string;
  windowTitle?: string;
  micActive: boolean;
  cameraActive: boolean;
  tccSignal?: boolean;
}

export interface WebEvidence {
  browser: string;
  tabUrl: string;
  tabTitle: string;
  micActive: boolean;
  cameraActive: boolean;
}

export interface DetectorEngine {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  onCandidate(callback: (candidate: MeetingCandidate) => void): void;
}
```

### 1.2 Extract Native Logic (`src/engines/native-engine.ts`)

Move from `detector.ts`:
- `NATIVE_MEETING_PROCESSES` constant
- `RECORDER_PROCESSES` constant  
- `findRunningMeetingProcesses()` method
- `detectActiveNativeMeetingSignal()` method
- `pollNativeAppMeetings()` method
- `looksLikeActiveNativeMeeting()` method
- TCC signal tracking (`lastTccMicSignalAt`, `lastTccCameraSignalAt`)
- `cachedMediaState` tracking
- `probeMediaState()` method

### 1.3 Extract Web Logic (`src/engines/web-engine.ts`)

Move from `detector.ts`:
- `BROWSER_PROBE_SCRIPTS` constant
- `getBrowserProbeTargets()` function
- `matchBrowserMeetingUrl()` function
- `matchBrowserMeetingTab()` function
- `isGoogleMeetMeetingUrl()`, `isZoomMeetingUrl()`, etc.
- `listBrowserTabs()` method
- `pollBrowserMeetingTabs()` method
- `refreshBrowserMeetingHints()` method
- `pickStrongestBrowserMeetingHint()` method
- `getBrowserMeetingHint()` method
- `inferBrowserHost()` method

## Phase 2: Add Arbitration Rules

### 2.1 Define Arbitration Types (`src/arbitration/types.ts`)

```typescript
export interface ArbitrationState {
  activeMeeting: ActiveMeetingState | null;
  nativeCandidates: Map<MeetingPlatform, NativeMeetingCandidate>;
  webCandidates: Map<MeetingPlatform, WebMeetingCandidate>;
  lastSeenBySource: Map<'native' | 'web', number>;
}

export interface ArbitrationResult {
  event: MeetingLifecycleEvent | null;
  suppressedCandidates: MeetingCandidate[];
}
```

### 2.2 Precedence Rules (`src/arbitration/rules.ts`)

1. **Same-platform precedence:** When both native and web have the same platform:
   - Prefer native if native has higher confidence
   - Prefer native if native has TCC mic signal
   - Prefer web if web has valid meeting URL

2. **Cross-platform conflict resolution:**
   - Newer candidate wins if >5s apart
   - Higher confidence wins if within 5s
   - Native wins ties if mic is active

3. **Stale candidate invalidation:**
   - Invalidate web candidate if browser tab URL no longer matches
   - Invalidate native candidate if process is no longer running
   - Invalidate any candidate after `meetingEndTimeoutMs` without refresh

4. **Suppression rules:**
   - Suppress web candidate if native has same platform with higher confidence
   - Suppress native candidate if it's a recorder process
   - Suppress any candidate with generic/idle window title

## Phase 3: Add Isolated Tests

### 3.1 Native Engine Tests (`test/engines/native-engine.test.mjs`)

- Native Teams detection with mic active
- Native Zoom detection with camera active  
- Native Slack huddle detection
- Recorder process suppression (OBS, Loom, etc.)
- Generic window title suppression
- TCC signal tracking

### 3.2 Web Engine Tests (`test/engines/web-engine.test.mjs`)

- Google Meet URL detection
- Zoom web URL detection
- Teams web URL detection
- Slack web huddle detection
- Stale browser hint invalidation
- Multiple meeting tabs resolution

### 3.3 Arbitration Tests (`test/arbitration/arbitrator.test.mjs`)

- Native vs web same-platform precedence
- Cross-platform conflict resolution
- Stale candidate cleanup
- Meeting lifecycle emission timing
- Platform switch (`meeting_changed`) detection

### 3.4 Cross-Contamination Regression Tests (`test/cross-contamination.test.mjs`)

- Meet vs Teams flapping scenario (from lessons learned)
- Browser hint interfering with native app
- Post-call browser handoff (generic Teams page after meeting)
- Multiple meeting apps open simultaneously

## Phase 4: Integration

### 4.1 Refactor `detector.ts`

The main `MeetingDetector` class becomes an orchestrator:

```typescript
export class MeetingDetector extends EventEmitter {
  private nativeEngine: NativeDetectorEngine;
  private webEngine: WebDetectorEngine;
  private arbitrator: MeetingArbitrator;
  
  constructor(options: MeetingDetectorOptions = {}) {
    // Initialize engines
    this.nativeEngine = new NativeDetectorEngine(options);
    this.webEngine = new WebDetectorEngine(options);
    this.arbitrator = new MeetingArbitrator(options);
    
    // Wire up candidates
    this.nativeEngine.onCandidate((candidate) => {
      const result = this.arbitrator.processCandidate(candidate);
      this.emitArbitrationResult(result);
    });
    
    this.webEngine.onCandidate((candidate) => {
      const result = this.arbitrator.processCandidate(candidate);
      this.emitArbitrationResult(result);
    });
  }
}
```

### 4.2 Backward Compatibility

- Keep all public API methods unchanged
- Keep all event names unchanged
- Keep all options unchanged
- Existing tests must pass without modification

## Success Criteria

From the ticket:

### Core Criteria
- [x] Detect active meetings with normalized platform identity
- [x] Support browser-based and native meeting sources (macOS path)
- [x] Validate Google Meet for both web and native/desktop-hosted meeting paths
- [x] Handle foreground/background/minimized attribution path
- [x] Trigger quickly on strong meeting evidence
- [x] Infer/emit meeting end via inactivity timeout
- [x] Suppress low-confidence launch preflight false positives
- [x] Handle repeated join/leave cycles without stale state
- [x] Provide stable consumer hooks: `meeting_started`, `meeting_changed`, `meeting_ended`
- [x] Ensure uncertain signals are `Unknown` or suppressed by default
- [x] Keep runtime stable with dedup + timeout state cleanup
- [x] Redact sensitive metadata by default in emitted signals

### Edge Cases (from ticket + lessons learned)
- Reject stale browser handoff after a real meeting ends
- Suppress post-call cleanup and redirect pages
- Keep preview/lobby/waiting-room surfaces non-meetings
- Detect Slack/Chromium popup meetings with `about:blank`
- Prevent generic platform landing pages from inheriting previous platform
- Emit new lifecycle for same-platform rejoins
- Resolve multiple tabs/windows for same platform
- Resolve cross-platform overlap correctly
- Prevent rapid platform flapping
- Suppress idle native helpers and webviews

## Test Plan

### Unit Tests
1. Native engine: process detection accuracy
2. Native engine: recorder suppression
3. Web engine: URL matcher coverage
4. Web engine: browser tab probing
5. Arbitration: precedence rules
6. Arbitration: stale invalidation

### Integration Tests  
1. Native-only meeting lifecycle
2. Web-only meeting lifecycle
3. Mixed native+web (same platform)
4. Mixed native+web (different platforms)
5. Platform handoff scenarios
6. Meeting end timeout

### Regression Tests
1. Meet vs Teams flapping (from lessons learned)
2. Post-call browser handoff false positive
3. Generic idle window suppression
4. Slack popup huddle detection
5. Teams `/v2/` prejoin vs admitted

## Implementation Order

1. **Test-first:** Write failing tests for each component
2. **Extract types:** Create `src/engines/types.ts` and `src/arbitration/types.ts`
3. **Extract matchers:** Move URL/process matchers to `src/matchers/`
4. **Build native engine:** Extract and test native detection
5. **Build web engine:** Extract and test web detection  
6. **Build arbitration:** Implement rules and state management
7. **Wire together:** Refactor `detector.ts` to use engines
8. **Run all tests:** Ensure backward compatibility
9. **Document:** Update README with architecture notes
