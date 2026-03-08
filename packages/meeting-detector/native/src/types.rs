//! Core type definitions for meeting-detector.
//!
//! These types mirror the TypeScript definitions and are exposed via napi-rs.

use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported meeting platforms.
///
/// Matches the TypeScript `MeetingPlatform` type.
#[napi(string_enum)]
#[derive(Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

impl fmt::Display for MeetingPlatform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            MeetingPlatform::MicrosoftTeams => "Microsoft Teams",
            MeetingPlatform::Zoom => "Zoom",
            MeetingPlatform::GoogleMeet => "Google Meet",
            MeetingPlatform::Slack => "Slack",
            MeetingPlatform::CiscoWebex => "Cisco Webex",
            MeetingPlatform::Discord => "Discord",
            MeetingPlatform::FaceTime => "FaceTime",
            MeetingPlatform::Skype => "Skype",
            MeetingPlatform::Whereby => "Whereby",
            MeetingPlatform::GoToMeeting => "GoToMeeting",
            MeetingPlatform::BlueJeans => "BlueJeans",
            MeetingPlatform::JitsiMeet => "Jitsi Meet",
            MeetingPlatform::EightByEight => "8x8",
            MeetingPlatform::RingCentral => "RingCentral",
            MeetingPlatform::BigBlueButton => "BigBlueButton",
            MeetingPlatform::AmazonChime => "Amazon Chime",
            MeetingPlatform::GoogleHangouts => "Google Hangouts",
            MeetingPlatform::AdobeConnect => "Adobe Connect",
            MeetingPlatform::TeamViewer => "TeamViewer",
            MeetingPlatform::AnyDesk => "AnyDesk",
            MeetingPlatform::ClickMeeting => "ClickMeeting",
            MeetingPlatform::AppearIn => "Appear.in",
            MeetingPlatform::Unknown => "Unknown",
        };
        write!(f, "{}", name)
    }
}

impl MeetingPlatform {
    /// Parse a platform name string into a MeetingPlatform.
    ///
    /// Handles various aliases and normalizations.
    pub fn from_string(s: &str) -> Self {
        let lower = s.to_lowercase();
        match lower.as_str() {
            "microsoft teams" | "teams" | "ms teams" => MeetingPlatform::MicrosoftTeams,
            "zoom" | "zoom.us" => MeetingPlatform::Zoom,
            "google meet" | "meet" | "googlemeet" => MeetingPlatform::GoogleMeet,
            "slack" | "slack huddle" | "slack call" => MeetingPlatform::Slack,
            "cisco webex" | "webex" | "webex meetings" => MeetingPlatform::CiscoWebex,
            "discord" => MeetingPlatform::Discord,
            "facetime" => MeetingPlatform::FaceTime,
            "skype" | "skype for business" => MeetingPlatform::Skype,
            "whereby" => MeetingPlatform::Whereby,
            "gotomeeting" | "goto meeting" => MeetingPlatform::GoToMeeting,
            "bluejeans" | "blue jeans" => MeetingPlatform::BlueJeans,
            "jitsi meet" | "jitsi" => MeetingPlatform::JitsiMeet,
            "8x8" | "8x8 meet" => MeetingPlatform::EightByEight,
            "ringcentral" | "ring central" => MeetingPlatform::RingCentral,
            "bigbluebutton" | "bbb" => MeetingPlatform::BigBlueButton,
            "amazon chime" | "chime" => MeetingPlatform::AmazonChime,
            "google hangouts" | "hangouts" => MeetingPlatform::GoogleHangouts,
            "adobe connect" => MeetingPlatform::AdobeConnect,
            "teamviewer" | "team viewer" => MeetingPlatform::TeamViewer,
            "anydesk" | "any desk" => MeetingPlatform::AnyDesk,
            "clickmeeting" | "click meeting" => MeetingPlatform::ClickMeeting,
            "appear.in" | "appearin" => MeetingPlatform::AppearIn,
            _ => MeetingPlatform::Unknown,
        }
    }
}

/// Confidence level for meeting detection.
#[napi(string_enum)]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Confidence {
    High,
    Medium,
    Low,
}

impl fmt::Display for Confidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Confidence::High => write!(f, "high"),
            Confidence::Medium => write!(f, "medium"),
            Confidence::Low => write!(f, "low"),
        }
    }
}

/// Verdict from TCC/permission system.
#[napi(string_enum)]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Verdict {
    Requested,
    Allowed,
    Denied,
    #[default]
    None,
}

impl Verdict {
    pub fn from_string(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "requested" => Verdict::Requested,
            "allowed" => Verdict::Allowed,
            "denied" => Verdict::Denied,
            _ => Verdict::None,
        }
    }
}

/// Raw meeting signal from platform detection.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[napi(ts_type = "string | undefined")]
    pub chrome_url: Option<String>,
}

impl Default for MeetingSignal {
    fn default() -> Self {
        Self {
            event: "meeting_signal".to_string(),
            timestamp: String::new(),
            service: String::new(),
            verdict: String::new(),
            preflight: false,
            process: String::new(),
            pid: String::new(),
            parent_pid: String::new(),
            process_path: String::new(),
            front_app: String::new(),
            window_title: String::new(),
            session_id: String::new(),
            camera_active: false,
            chrome_url: None,
        }
    }
}

/// Lifecycle event reason.
#[napi(string_enum)]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecycleReason {
    Signal,
    Switch,
    Timeout,
    Stop,
}

impl fmt::Display for LifecycleReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LifecycleReason::Signal => write!(f, "signal"),
            LifecycleReason::Switch => write!(f, "switch"),
            LifecycleReason::Timeout => write!(f, "timeout"),
            LifecycleReason::Stop => write!(f, "stop"),
        }
    }
}

/// Meeting lifecycle event (start/change/end).
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingLifecycleEvent {
    pub event: String,
    pub timestamp: String,
    pub platform: String,
    #[napi(ts_type = "string | undefined")]
    pub previous_platform: Option<String>,
    pub confidence: String,
    pub reason: String,
}

impl MeetingLifecycleEvent {
    pub fn meeting_started(
        platform: MeetingPlatform,
        confidence: Confidence,
    ) -> Self {
        Self {
            event: "meeting_started".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            platform: platform.to_string(),
            previous_platform: None,
            confidence: confidence.to_string(),
            reason: LifecycleReason::Signal.to_string(),
        }
    }

    pub fn meeting_changed(
        platform: MeetingPlatform,
        previous: MeetingPlatform,
        confidence: Confidence,
    ) -> Self {
        Self {
            event: "meeting_changed".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            platform: platform.to_string(),
            previous_platform: Some(previous.to_string()),
            confidence: confidence.to_string(),
            reason: LifecycleReason::Switch.to_string(),
        }
    }

    pub fn meeting_ended(
        platform: MeetingPlatform,
        confidence: Confidence,
        reason: LifecycleReason,
    ) -> Self {
        Self {
            event: "meeting_ended".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            platform: platform.to_string(),
            previous_platform: None,
            confidence: confidence.to_string(),
            reason: reason.to_string(),
        }
    }
}

/// Detector configuration options.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectorOptions {
    /// Enable debug logging
    #[napi(ts_type = "boolean | undefined")]
    pub debug: Option<bool>,

    /// Session deduplication window in milliseconds (default: 60000)
    #[napi(ts_type = "number | undefined")]
    pub session_deduplication_ms: Option<i64>,

    /// Time without signals before inferring meeting end (default: 30000)
    #[napi(ts_type = "number | undefined")]
    pub meeting_end_timeout_ms: Option<i64>,

    /// Emit "Unknown" platform lifecycle events (default: false)
    #[napi(ts_type = "boolean | undefined")]
    pub emit_unknown: Option<bool>,

    /// Include sensitive fields like window_title (default: false)
    #[napi(ts_type = "boolean | undefined")]
    pub include_sensitive_metadata: Option<bool>,

    /// Include raw signal in lifecycle events (default: false)
    #[napi(ts_type = "boolean | undefined")]
    pub include_raw_signal_in_lifecycle: Option<bool>,

    /// Probe for active meetings on startup (default: true)
    #[napi(ts_type = "boolean | undefined")]
    pub startup_probe: Option<bool>,
}

impl Default for DetectorOptions {
    fn default() -> Self {
        Self {
            debug: Some(false),
            session_deduplication_ms: Some(60000i64),
            meeting_end_timeout_ms: Some(30000i64),
            emit_unknown: Some(false),
            include_sensitive_metadata: Some(false),
            include_raw_signal_in_lifecycle: Some(false),
            startup_probe: Some(true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_display() {
        assert_eq!(MeetingPlatform::MicrosoftTeams.to_string(), "Microsoft Teams");
        assert_eq!(MeetingPlatform::GoogleMeet.to_string(), "Google Meet");
        assert_eq!(MeetingPlatform::EightByEight.to_string(), "8x8");
    }

    #[test]
    fn test_platform_from_string() {
        assert_eq!(MeetingPlatform::from_string("Microsoft Teams"), MeetingPlatform::MicrosoftTeams);
        assert_eq!(MeetingPlatform::from_string("teams"), MeetingPlatform::MicrosoftTeams);
        assert_eq!(MeetingPlatform::from_string("ms teams"), MeetingPlatform::MicrosoftTeams);
        assert_eq!(MeetingPlatform::from_string("zoom"), MeetingPlatform::Zoom);
        assert_eq!(MeetingPlatform::from_string("google meet"), MeetingPlatform::GoogleMeet);
        assert_eq!(MeetingPlatform::from_string("unknown platform"), MeetingPlatform::Unknown);
    }

    #[test]
    fn test_confidence_display() {
        assert_eq!(Confidence::High.to_string(), "high");
        assert_eq!(Confidence::Medium.to_string(), "medium");
        assert_eq!(Confidence::Low.to_string(), "low");
    }

    #[test]
    fn test_lifecycle_event_creation() {
        let started = MeetingLifecycleEvent::meeting_started(
            MeetingPlatform::Zoom,
            Confidence::High,
        );
        assert_eq!(started.event, "meeting_started");
        assert_eq!(started.platform, "Zoom");
        assert_eq!(started.confidence, "high");
        assert!(started.previous_platform.is_none());

        let changed = MeetingLifecycleEvent::meeting_changed(
            MeetingPlatform::GoogleMeet,
            MeetingPlatform::Zoom,
            Confidence::Medium,
        );
        assert_eq!(changed.event, "meeting_changed");
        assert_eq!(changed.platform, "Google Meet");
        assert_eq!(changed.previous_platform, Some("Zoom".to_string()));

        let ended = MeetingLifecycleEvent::meeting_ended(
            MeetingPlatform::Zoom,
            Confidence::High,
            LifecycleReason::Timeout,
        );
        assert_eq!(ended.event, "meeting_ended");
        assert_eq!(ended.reason, "timeout");
    }
}
