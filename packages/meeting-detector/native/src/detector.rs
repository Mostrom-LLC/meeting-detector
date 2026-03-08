//! Platform-agnostic meeting detection state machine.
//!
//! This module handles the core detection logic:
//! - Session deduplication
//! - Confidence scoring
//! - Lifecycle event generation
//! - Meeting end timeout handling

use crate::error::{DetectorError, DetectorResult};
use crate::matchers::{MatchContext, MatcherRegistry};
use crate::types::{
    Confidence, DetectorOptions, LifecycleReason, MeetingLifecycleEvent,
    MeetingPlatform, MeetingSignal,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Session info for deduplication.
#[derive(Debug, Clone)]
struct SessionInfo {
    last_seen: Instant,
    signal: MeetingSignal,
}

/// Pending low-confidence signal.
#[derive(Debug, Clone)]
struct PendingConfidenceSignal {
    first_seen: Instant,
    last_seen: Instant,
    count: u32,
    signal: MeetingSignal,
}

/// Active meeting state.
#[derive(Debug, Clone)]
struct ActiveMeetingState {
    platform: MeetingPlatform,
    last_seen: Instant,
    confidence: Confidence,
    signal: MeetingSignal,
}

/// Configuration for the detector state machine.
#[derive(Debug, Clone)]
pub struct DetectorConfig {
    pub debug: bool,
    pub session_deduplication_ms: u64,
    pub meeting_end_timeout_ms: u64,
    pub emit_unknown: bool,
    pub include_sensitive_metadata: bool,
    pub include_raw_signal_in_lifecycle: bool,
    pub startup_probe: bool,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            debug: false,
            session_deduplication_ms: 60000,
            meeting_end_timeout_ms: 30000,
            emit_unknown: false,
            include_sensitive_metadata: false,
            include_raw_signal_in_lifecycle: false,
            startup_probe: true,
        }
    }
}

impl From<DetectorOptions> for DetectorConfig {
    fn from(opts: DetectorOptions) -> Self {
        Self {
            debug: opts.debug.unwrap_or(false),
            session_deduplication_ms: opts.session_deduplication_ms.unwrap_or(60000),
            meeting_end_timeout_ms: opts.meeting_end_timeout_ms.unwrap_or(30000),
            emit_unknown: opts.emit_unknown.unwrap_or(false),
            include_sensitive_metadata: opts.include_sensitive_metadata.unwrap_or(false),
            include_raw_signal_in_lifecycle: opts.include_raw_signal_in_lifecycle.unwrap_or(false),
            startup_probe: opts.startup_probe.unwrap_or(true),
        }
    }
}

/// Meeting detection state machine.
pub struct DetectorStateMachine {
    config: DetectorConfig,
    matcher_registry: MatcherRegistry,
    active_sessions: HashMap<String, SessionInfo>,
    pending_confidence: HashMap<String, PendingConfidenceSignal>,
    active_meeting: Option<ActiveMeetingState>,
    meeting_end_scheduled: Option<Instant>,
}

impl DetectorStateMachine {
    /// Low confidence window duration.
    const LOW_CONFIDENCE_WINDOW: Duration = Duration::from_millis(45000);
    /// Minimum signals for low confidence fallback.
    const LOW_CONFIDENCE_MIN_SIGNALS: u32 = 4;
    /// Minimum duration for low confidence fallback.
    const LOW_CONFIDENCE_MIN_DURATION: Duration = Duration::from_millis(30000);

    /// Services prone to preflight checks.
    const PRECHECK_PRONE_SERVICES: &'static [&'static str] = &[
        "microsoft teams",
        "zoom",
        "cisco webex",
        "slack",
    ];

    /// Create a new state machine.
    pub fn new(config: DetectorConfig) -> Self {
        Self {
            config,
            matcher_registry: MatcherRegistry::new(),
            active_sessions: HashMap::new(),
            pending_confidence: HashMap::new(),
            active_meeting: None,
            meeting_end_scheduled: None,
        }
    }

    /// Process an incoming signal.
    ///
    /// Returns lifecycle events generated from this signal.
    pub fn process_signal(&mut self, signal: MeetingSignal) -> Vec<MeetingLifecycleEvent> {
        let mut events = Vec::new();

        // Check if we should ignore this signal
        if self.should_ignore_signal(&signal) {
            if self.config.debug {
                eprintln!("[Detector] Ignoring signal: {:?}", signal.service);
            }
            return events;
        }

        // Resolve confidence
        let (confident_signal, confidence) = match self.resolve_confidence(signal) {
            Some(result) => result,
            None => return events,
        };

        // Check for duplicates
        if self.is_duplicate_session(&confident_signal) {
            if self.config.debug {
                eprintln!("[Detector] Skipping duplicate session");
            }
            return events;
        }

        // Match the platform
        let ctx = self.signal_to_match_context(&confident_signal);
        let platform = self.matcher_registry.match_platform(&ctx);

        // Skip unknown platforms unless configured to emit
        if platform == MeetingPlatform::Unknown && !self.config.emit_unknown {
            return events;
        }

        // Update lifecycle
        if let Some(event) = self.update_meeting_lifecycle(platform, confidence, &confident_signal) {
            events.push(event);
        }

        // Record this session
        self.record_session(&confident_signal);

        events
    }

    /// Check if the meeting end timeout has elapsed.
    pub fn check_meeting_end(&mut self) -> Option<MeetingLifecycleEvent> {
        if let Some(scheduled) = self.meeting_end_scheduled {
            if Instant::now() >= scheduled {
                self.meeting_end_scheduled = None;
                if let Some(meeting) = self.active_meeting.take() {
                    return Some(MeetingLifecycleEvent::meeting_ended(
                        meeting.platform,
                        meeting.confidence,
                        LifecycleReason::Timeout,
                    ));
                }
            }
        }
        None
    }

    /// Handle detector stop - emit meeting_ended if active.
    pub fn on_stop(&mut self) -> Option<MeetingLifecycleEvent> {
        self.meeting_end_scheduled = None;
        if let Some(meeting) = self.active_meeting.take() {
            return Some(MeetingLifecycleEvent::meeting_ended(
                meeting.platform,
                meeting.confidence,
                LifecycleReason::Stop,
            ));
        }
        None
    }

    /// Check if we should ignore this signal.
    fn should_ignore_signal(&self, signal: &MeetingSignal) -> bool {
        let process = signal.process.to_lowercase();
        let service = signal.service.to_lowercase();

        // System processes to ignore
        const SYSTEM_PROCESSES: &[&str] = &[
            "sirinc", "afplay", "systemsoundserver", "wavelink",
            "granola helper", "webkit.gpu", "webkit.networking",
            "electron helper", "caphost", "webview helper",
        ];

        // Generic services to ignore
        const GENERIC_SERVICES: &[&str] = &[
            "electron", "terminal", "granola", "finder", "xcode",
            "tips", "google chrome", "safari", "firefox",
            "microsoft edge", "photo booth", "quicktime player",
            "quicktime playerx",
        ];

        // Check system processes
        if SYSTEM_PROCESSES.iter().any(|p| process.contains(p)) {
            return true;
        }

        // Check generic services
        if GENERIC_SERVICES.contains(&service.as_str()) {
            return true;
        }

        // Skip unknown unless configured
        if service == "unknown" && !self.config.emit_unknown {
            return true;
        }

        // Camera initialization filter
        if signal.verdict == "requested" 
            && signal.window_title.trim().is_empty()
            && !signal.camera_active
        {
            return true;
        }

        false
    }

    /// Resolve signal confidence.
    fn resolve_confidence(&mut self, signal: MeetingSignal) -> Option<(MeetingSignal, Confidence)> {
        let service = signal.service.to_lowercase();
        let now = Instant::now();

        // High confidence signals pass through immediately
        if signal.camera_active || signal.verdict == "allowed" {
            // Clear any pending low-confidence for this service
            self.pending_confidence.remove(&service);
            return Some((signal, Confidence::High));
        }

        // Check if this service is prone to preflight checks
        let is_precheck_prone = Self::PRECHECK_PRONE_SERVICES
            .iter()
            .any(|s| service.contains(s));

        if !is_precheck_prone {
            return Some((signal, Confidence::Medium));
        }

        // Track low-confidence signals
        let pending = self.pending_confidence
            .entry(service.clone())
            .or_insert_with(|| PendingConfidenceSignal {
                first_seen: now,
                last_seen: now,
                count: 0,
                signal: signal.clone(),
            });

        pending.last_seen = now;
        pending.count += 1;
        pending.signal = signal;

        // Check if we've exceeded the confidence window
        let duration = now.duration_since(pending.first_seen);
        if duration > Self::LOW_CONFIDENCE_WINDOW {
            self.pending_confidence.remove(&service);
            return None;
        }

        // Check if we have enough signals
        if pending.count >= Self::LOW_CONFIDENCE_MIN_SIGNALS
            && duration >= Self::LOW_CONFIDENCE_MIN_DURATION
        {
            let result = pending.signal.clone();
            self.pending_confidence.remove(&service);
            return Some((result, Confidence::Low));
        }

        // Still collecting signals
        None
    }

    /// Check if this is a duplicate session.
    fn is_duplicate_session(&self, signal: &MeetingSignal) -> bool {
        if let Some(session) = self.active_sessions.get(&signal.session_id) {
            let elapsed = Instant::now().duration_since(session.last_seen);
            return elapsed.as_millis() < self.config.session_deduplication_ms as u128;
        }
        false
    }

    /// Record a session for deduplication.
    fn record_session(&mut self, signal: &MeetingSignal) {
        self.active_sessions.insert(
            signal.session_id.clone(),
            SessionInfo {
                last_seen: Instant::now(),
                signal: signal.clone(),
            },
        );
    }

    /// Convert signal to match context.
    fn signal_to_match_context(&self, signal: &MeetingSignal) -> MatchContext {
        MatchContext::new(&signal.process, &signal.window_title)
            .with_camera_active(signal.camera_active)
    }

    /// Update meeting lifecycle state.
    fn update_meeting_lifecycle(
        &mut self,
        platform: MeetingPlatform,
        confidence: Confidence,
        signal: &MeetingSignal,
    ) -> Option<MeetingLifecycleEvent> {
        let now = Instant::now();

        // Cancel any scheduled meeting end
        self.meeting_end_scheduled = None;

        match &self.active_meeting {
            None => {
                // New meeting started
                self.active_meeting = Some(ActiveMeetingState {
                    platform,
                    last_seen: now,
                    confidence,
                    signal: signal.clone(),
                });
                Some(MeetingLifecycleEvent::meeting_started(platform, confidence))
            }
            Some(current) if current.platform != platform => {
                // Meeting platform changed
                let previous = current.platform;
                self.active_meeting = Some(ActiveMeetingState {
                    platform,
                    last_seen: now,
                    confidence,
                    signal: signal.clone(),
                });
                Some(MeetingLifecycleEvent::meeting_changed(platform, previous, confidence))
            }
            Some(_) => {
                // Same meeting, update last_seen
                if let Some(meeting) = &mut self.active_meeting {
                    meeting.last_seen = now;
                    meeting.signal = signal.clone();
                }
                // Schedule meeting end timeout
                self.meeting_end_scheduled = Some(
                    now + Duration::from_millis(self.config.meeting_end_timeout_ms)
                );
                None
            }
        }
    }

    /// Clean up old sessions.
    pub fn cleanup_sessions(&mut self) {
        let now = Instant::now();
        let timeout = Duration::from_millis(self.config.session_deduplication_ms);
        
        self.active_sessions.retain(|_, session| {
            now.duration_since(session.last_seen) < timeout
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_signal(service: &str, camera_active: bool) -> MeetingSignal {
        MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: service.to_string(),
            verdict: if camera_active { "allowed".to_string() } else { "requested".to_string() },
            preflight: false,
            process: service.to_string(),
            pid: "123".to_string(),
            parent_pid: "1".to_string(),
            process_path: format!("/Applications/{}.app", service),
            front_app: service.to_string(),
            window_title: format!("{} Meeting", service),
            session_id: format!("session-{}", rand::random::<u32>()),
            camera_active,
            chrome_url: None,
        }
    }

    #[test]
    fn test_meeting_lifecycle() {
        let config = DetectorConfig::default();
        let mut machine = DetectorStateMachine::new(config);

        // Start a Zoom meeting
        let signal = test_signal("Zoom", true);
        let events = machine.process_signal(signal);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "meeting_started");
        assert_eq!(events[0].platform, "Zoom");
    }

    #[test]
    fn test_ignore_system_processes() {
        let config = DetectorConfig::default();
        let mut machine = DetectorStateMachine::new(config);

        // System process should be ignored
        let mut signal = test_signal("SiriNCService", true);
        signal.process = "sirinc".to_string();
        let events = machine.process_signal(signal);

        assert!(events.is_empty());
    }

    #[test]
    fn test_meeting_change() {
        let config = DetectorConfig::default();
        let mut machine = DetectorStateMachine::new(config);

        // Start Zoom meeting
        let zoom_signal = test_signal("Zoom", true);
        let _ = machine.process_signal(zoom_signal);

        // Switch to Teams
        let mut teams_signal = test_signal("Microsoft Teams", true);
        teams_signal.session_id = "new-session".to_string();
        let events = machine.process_signal(teams_signal);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "meeting_changed");
        assert_eq!(events[0].platform, "Microsoft Teams");
        assert_eq!(events[0].previous_platform, Some("Zoom".to_string()));
    }

    #[test]
    fn test_stop_emits_ended() {
        let config = DetectorConfig::default();
        let mut machine = DetectorStateMachine::new(config);

        // Start a meeting
        let signal = test_signal("Zoom", true);
        machine.process_signal(signal);

        // Stop detector
        let event = machine.on_stop();

        assert!(event.is_some());
        let event = event.unwrap();
        assert_eq!(event.event, "meeting_ended");
        assert_eq!(event.reason, "stop");
    }
}
