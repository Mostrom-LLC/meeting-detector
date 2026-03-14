# Meeting Detector - Code Improvements

## High Priority Improvements

### 1. **Fix Type Safety Issue** ⚠️
The `MeetingSignal.service` type definition doesn't match actual usage.

**Location**: `packages/meeting-detector/src/types.ts:4`

**Current**:
```typescript
service: 'microphone' | 'camera' | '';
```

**Problem**: The code actually sets this to app names like "Slack", "Microsoft Teams", "Google Meet", etc. (detector.ts:294-296)

**Fix**: Update the type to match reality:
```typescript
service: string;  // App name (e.g., "Slack", "Microsoft Teams") or hardware service ("microphone", "camera")
```

---

### 2. **Memory Leak in Session Tracking**
The `activeSessions` Map only cleans up when new signals arrive. If monitoring runs for days without signals, expired sessions accumulate.

**Location**: `packages/meeting-detector/src/detector.ts:246`

**Current**: Cleanup only on new signals

**Fix**: Add periodic cleanup:
```typescript
private cleanupInterval?: NodeJS.Timeout;

public start(callback?: MeetingEventCallback): void {
  // ... existing code ...

  // Periodic cleanup every 5 minutes
  this.cleanupInterval = setInterval(() => {
    this.cleanupExpiredSessions();
  }, 5 * 60 * 1000);
}

public stop(): void {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
  }
  // ... existing code ...
}
```

---

### 3. **Validate Script Exists Before Starting**

**Location**: `packages/meeting-detector/src/detector.ts:37`

**Fix**: Add validation before spawning process:
```typescript
import { access } from 'node:fs/promises';

public async start(callback?: MeetingEventCallback): Promise<void> {
  // Verify script exists
  try {
    await access(this.options.scriptPath);
  } catch {
    throw new Error(`Meeting detection script not found: ${this.options.scriptPath}`);
  }

  // ... rest of start logic ...
}
```

**Note**: This changes the API to async, consider adding a sync alternative or doing sync validation.

---

## Medium Priority Improvements

### 4. **Optimize App Name Transformation**
Replace the long if-else chain with a lookup map for better maintainability.

**Location**: `packages/meeting-detector/src/detector.ts:314-366`

**Fix**:
```typescript
private static readonly APP_PATTERNS: Array<{pattern: RegExp, name: string}> = [
  { pattern: /slack/i, name: 'Slack' },
  { pattern: /msteams|microsoft teams|teams/i, name: 'Microsoft Teams' },
  { pattern: /zoom/i, name: 'Zoom' },
  { pattern: /webex|cisco webex/i, name: 'Webex' },
  { pattern: /google meet|meet\.google\.com/i, name: 'Google Meet' },
  { pattern: /skype/i, name: 'Skype' },
  { pattern: /discord/i, name: 'Discord' },
  { pattern: /facetime/i, name: 'FaceTime' },
  { pattern: /gotomeeting|goto meeting/i, name: 'GoToMeeting' },
  { pattern: /bluejeans|blue jeans/i, name: 'BlueJeans' },
  { pattern: /jitsi/i, name: 'Jitsi Meet' },
  { pattern: /whereby/i, name: 'Whereby' },
  { pattern: /8x8/i, name: '8x8' },
  { pattern: /ringcentral|ring central/i, name: 'RingCentral' },
  { pattern: /bigbluebutton|big blue button/i, name: 'BigBlueButton' },
  { pattern: /chime|amazon chime/i, name: 'Amazon Chime' },
  { pattern: /hangouts|google hangouts/i, name: 'Google Hangouts' },
  { pattern: /adobe connect/i, name: 'Adobe Connect' },
  { pattern: /teamviewer/i, name: 'TeamViewer' },
  { pattern: /anydesk/i, name: 'AnyDesk' },
  { pattern: /clickmeeting/i, name: 'ClickMeeting' },
  { pattern: /appear\.in/i, name: 'Appear.in' },
];

private transformAppName(frontApp: string, process: string): string {
  const combined = `${frontApp} ${process}`.toLowerCase();

  for (const { pattern, name } of MeetingDetector.APP_PATTERNS) {
    if (pattern.test(combined)) {
      return name;
    }
  }

  return frontApp || 'Meeting App';
}
```

**Benefits**:
- Easier to add new apps
- More maintainable
- Better performance with RegExp caching

---

### 5. **Make Filters Configurable**
Allow users to customize filtering behavior.

**Location**: `packages/meeting-detector/src/types.ts`

**Fix**:
```typescript
export interface MeetingDetectorOptions {
  // ... existing options ...

  /**
   * Additional process patterns to ignore
   * @default []
   */
  customIgnorePatterns?: string[];

  /**
   * Custom app name transformations
   * @default []
   */
  customAppMappings?: Array<{pattern: RegExp, name: string}>;

  /**
   * Disable built-in filtering rules
   * @default false
   */
  disableDefaultFilters?: boolean;
}
```

---

### 6. **Add Metrics/Stats**
Provide visibility into detector performance.

**Location**: `packages/meeting-detector/src/detector.ts`

**Fix**:
```typescript
export interface MeetingStats {
  signalsReceived: number;
  signalsFiltered: number;
  signalsEmitted: number;
  sessionsTracked: number;
  uptime: number;
}

export class MeetingDetector extends EventEmitter {
  // ...
  private stats = {
    signalsReceived: 0,
    signalsFiltered: 0,
    signalsEmitted: 0,
    startTime: 0
  };

  public start(callback?: MeetingEventCallback): void {
    // ...
    this.stats.startTime = Date.now();
    this.stats.signalsReceived = 0;
    this.stats.signalsFiltered = 0;
    this.stats.signalsEmitted = 0;
  }

  public getStats(): MeetingStats {
    return {
      signalsReceived: this.stats.signalsReceived,
      signalsFiltered: this.stats.signalsFiltered,
      signalsEmitted: this.stats.signalsEmitted,
      sessionsTracked: this.activeSessions.size,
      uptime: this.stats.startTime > 0 ? Date.now() - this.stats.startTime : 0
    };
  }

  // Update in shouldIgnoreSignal:
  private shouldIgnoreSignal(signal: MeetingSignal): boolean {
    this.stats.signalsReceived++;
    const shouldIgnore = /* ... existing logic ... */;
    if (shouldIgnore) {
      this.stats.signalsFiltered++;
    }
    return shouldIgnore;
  }

  // Update in emit:
  this.stats.signalsEmitted++;
  this.emit('meeting', signal);
}
```

---

### 7. **Add Pause/Resume Functionality**
Allow temporary suspension of signal processing without stopping the process.

**Location**: `packages/meeting-detector/src/detector.ts`

**Fix**:
```typescript
export class MeetingDetector extends EventEmitter {
  private paused = false;

  /**
   * Pause signal processing (process continues but signals are ignored)
   */
  public pause(): void {
    this.paused = true;
    if (this.options.debug) {
      console.log('[MeetingDetector] Paused');
    }
  }

  /**
   * Resume signal processing
   */
  public resume(): void {
    this.paused = false;
    if (this.options.debug) {
      console.log('[MeetingDetector] Resumed');
    }
  }

  /**
   * Check if the detector is currently paused
   */
  public isPaused(): boolean {
    return this.paused;
  }

  // In stdout handler:
  this.process.stdout?.on('data', (data: Buffer) => {
    if (this.paused) {
      return; // Skip processing while paused
    }
    // ... existing logic ...
  });
}
```

---

## Low Priority Improvements

### 8. **Better Error Context**
Provide more helpful error messages.

**Location**: `packages/meeting-detector/src/detector.ts:91-93`

**Fix**:
```typescript
this.process.on('error', (error) => {
  const enhancedError = new Error(
    `Meeting detector process error: ${error.message}\nScript: ${this.options.scriptPath}`
  );
  enhancedError.cause = error;
  this.emit('error', enhancedError);
});
```

---

### 9. **Add Auto-Restart Logic**
Automatically restart the process if it crashes.

**Location**: `packages/meeting-detector/src/types.ts` and `detector.ts`

**Fix**:
```typescript
// types.ts
export interface MeetingDetectorOptions {
  // ...
  /**
   * Automatically restart the process if it exits unexpectedly
   * @default false
   */
  autoRestart?: boolean;

  /**
   * Maximum number of restart attempts
   * @default 3
   */
  maxRestarts?: number;

  /**
   * Delay between restart attempts in milliseconds
   * @default 1000
   */
  restartDelay?: number;
}

// detector.ts
export class MeetingDetector extends EventEmitter {
  private restartCount = 0;
  private restartTimer?: NodeJS.Timeout;

  constructor(options: MeetingDetectorOptions = {}) {
    super();
    this.options = {
      scriptPath: defaultScriptPath,
      debug: options.debug || false,
      sessionDeduplicationMs: options.sessionDeduplicationMs || 60000,
      autoRestart: options.autoRestart || false,
      maxRestarts: options.maxRestarts || 3,
      restartDelay: options.restartDelay || 1000
    };
  }

  this.process.on('exit', (code, signal) => {
    if (this.options.debug) {
      console.log(`[MeetingDetector] Process exited with code ${code}, signal ${signal}`);
    }

    const wasRunning = !!this.process;
    this.process = undefined;
    this.emit('exit', { code, signal });

    // Auto-restart logic
    if (wasRunning && this.options.autoRestart && this.restartCount < this.options.maxRestarts) {
      if (this.options.debug) {
        console.log(`[MeetingDetector] Restarting in ${this.options.restartDelay}ms (attempt ${this.restartCount + 1}/${this.options.maxRestarts})`);
      }

      this.restartTimer = setTimeout(() => {
        this.restartCount++;
        try {
          this.start();
        } catch (error) {
          this.emit('error', new Error(`Restart failed: ${error}`));
        }
      }, this.options.restartDelay);
    } else if (this.restartCount >= this.options.maxRestarts) {
      this.emit('error', new Error(`Max restart attempts (${this.options.maxRestarts}) reached`));
    }
  });

  public stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.restartCount = 0; // Reset restart counter on manual stop
    // ... existing stop logic ...
  }
}
```

---

### 10. **Structured Logging**
Replace console.log with structured logging.

**Location**: `packages/meeting-detector/src/types.ts` and `detector.ts`

**Fix**:
```typescript
// types.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface MeetingDetectorOptions {
  // ...
  /**
   * Minimum log level to emit
   * @default 'info'
   */
  logLevel?: LogLevel;

  /**
   * Custom logger function
   */
  logger?: (level: LogLevel, message: string, data?: any) => void;
}

// detector.ts
export class MeetingDetector extends EventEmitter {
  private static readonly LOG_LEVELS: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };

  private log(level: LogLevel, message: string, data?: any): void {
    const currentLevel = this.options.logLevel || 'info';
    const shouldLog = MeetingDetector.LOG_LEVELS[level] <= MeetingDetector.LOG_LEVELS[currentLevel];

    if (!shouldLog && !this.options.debug) {
      return;
    }

    if (this.options.logger) {
      this.options.logger(level, message, data);
    } else {
      const prefix = `[MeetingDetector:${level.toUpperCase()}]`;
      if (data) {
        console.log(prefix, message, data);
      } else {
        console.log(prefix, message);
      }
    }
  }

  // Replace all console.log calls:
  // Before: console.log('[MeetingDetector] Started monitoring');
  // After:  this.log('info', 'Started monitoring');
}
```

---

## Code Quality Improvements

### 11. **Add Comprehensive JSDoc Comments**
Many public methods lack documentation.

**Location**: Throughout `packages/meeting-detector/src/detector.ts`

**Examples**:
```typescript
/**
 * Get current monitoring statistics including signal counts and session tracking
 * @returns Statistics object with signal counts, session info, and uptime
 * @example
 * const stats = detector.getStats();
 * console.log(`Received ${stats.signalsReceived} signals, emitted ${stats.signalsEmitted}`);
 */
public getStats(): MeetingStats {
  // ...
}

/**
 * Add a listener for meeting events
 * @param callback Function to call when meeting signals are detected
 * @example
 * detector.onMeeting((signal) => {
 *   console.log(`${signal.service} meeting detected`);
 * });
 */
public onMeeting(callback: MeetingEventCallback): void {
  // ...
}

/**
 * Check if the detector is currently running
 * @returns true if monitoring is active, false otherwise
 */
public isRunning(): boolean {
  // ...
}
```

---

### 12. **Extract Magic Numbers to Constants**
Make the code more maintainable by extracting hardcoded values.

**Location**: Throughout `packages/meeting-detector/src/detector.ts`

**Fix**:
```typescript
export class MeetingDetector extends EventEmitter {
  private static readonly DEFAULT_SESSION_TIMEOUT_MS = 60000; // 60 seconds
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly RESTART_DELAY_MS = 1000; // 1 second
  private static readonly MAX_RESTART_ATTEMPTS = 3;

  // Use in constructor:
  this.options = {
    // ...
    sessionDeduplicationMs: options.sessionDeduplicationMs || MeetingDetector.DEFAULT_SESSION_TIMEOUT_MS
  };
}
```

---

## Bash Script Improvements

### 13. **Add Error Handling to Shell Script**
The bash script could benefit from better error handling.

**Location**: `packages/meeting-detector/meeting-detect.sh`

**Suggestions**:
- Add trap handlers for cleanup
- Validate required commands exist (osascript, log, ps, etc.)
- Handle cases where System Events permissions are denied

**Example**:
```bash
# Add at the top after set -euo pipefail
trap cleanup EXIT INT TERM

cleanup() {
  # Cleanup logic here
  exit 0
}

# Validate required commands
for cmd in osascript ps pgrep date; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: Required command '$cmd' not found" >&2
    exit 1
  fi
done
```

---

## Testing Improvements

### 14. **Add Unit Tests**
No test files found. Consider adding:
- Unit tests for signal parsing
- Unit tests for filtering logic
- Unit tests for session deduplication
- Mock tests for the bash script integration

**Suggested structure**:
```
packages/meeting-detector/
  src/
  test/
    detector.test.ts
    filtering.test.ts
    session-deduplication.test.ts
```

---

## Recommended Implementation Order

1. **Phase 1 - Critical Fixes**:
   - #1: Fix type safety issue
   - #2: Fix memory leak
   - #3: Add script validation

2. **Phase 2 - Quality Improvements**:
   - #4: Optimize app name transformation
   - #12: Extract magic numbers
   - #11: Add JSDoc comments

3. **Phase 3 - Features**:
   - #6: Add metrics/stats
   - #7: Add pause/resume
   - #5: Make filters configurable

4. **Phase 4 - Robustness**:
   - #9: Add auto-restart
   - #8: Better error context
   - #10: Structured logging

5. **Phase 5 - Long-term**:
   - #13: Bash script improvements
   - #14: Add unit tests
