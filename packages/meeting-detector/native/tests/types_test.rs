//! Unit tests for types module.
//!
//! These tests verify:
//! - Platform enum serialization/deserialization
//! - Platform name parsing and normalization
//! - Lifecycle event creation
//! - Confidence levels

use meeting_detector_native::types::*;

#[test]
fn test_meeting_platform_display() {
    // Standard platforms
    assert_eq!(MeetingPlatform::MicrosoftTeams.to_string(), "Microsoft Teams");
    assert_eq!(MeetingPlatform::GoogleMeet.to_string(), "Google Meet");
    assert_eq!(MeetingPlatform::Zoom.to_string(), "Zoom");
    assert_eq!(MeetingPlatform::Slack.to_string(), "Slack");
    assert_eq!(MeetingPlatform::CiscoWebex.to_string(), "Cisco Webex");
    
    // Edge cases
    assert_eq!(MeetingPlatform::EightByEight.to_string(), "8x8");
    assert_eq!(MeetingPlatform::AppearIn.to_string(), "Appear.in");
    assert_eq!(MeetingPlatform::Unknown.to_string(), "Unknown");
}

#[test]
fn test_meeting_platform_from_string() {
    // Exact matches
    assert_eq!(MeetingPlatform::from_string("Microsoft Teams"), MeetingPlatform::MicrosoftTeams);
    assert_eq!(MeetingPlatform::from_string("Zoom"), MeetingPlatform::Zoom);
    assert_eq!(MeetingPlatform::from_string("Google Meet"), MeetingPlatform::GoogleMeet);
    
    // Case insensitivity
    assert_eq!(MeetingPlatform::from_string("ZOOM"), MeetingPlatform::Zoom);
    assert_eq!(MeetingPlatform::from_string("google meet"), MeetingPlatform::GoogleMeet);
    assert_eq!(MeetingPlatform::from_string("MICROSOFT TEAMS"), MeetingPlatform::MicrosoftTeams);
    
    // Aliases
    assert_eq!(MeetingPlatform::from_string("teams"), MeetingPlatform::MicrosoftTeams);
    assert_eq!(MeetingPlatform::from_string("ms teams"), MeetingPlatform::MicrosoftTeams);
    assert_eq!(MeetingPlatform::from_string("meet"), MeetingPlatform::GoogleMeet);
    assert_eq!(MeetingPlatform::from_string("webex"), MeetingPlatform::CiscoWebex);
    
    // Unknown values
    assert_eq!(MeetingPlatform::from_string(""), MeetingPlatform::Unknown);
    assert_eq!(MeetingPlatform::from_string("random app"), MeetingPlatform::Unknown);
}

#[test]
fn test_confidence_display() {
    assert_eq!(Confidence::High.to_string(), "high");
    assert_eq!(Confidence::Medium.to_string(), "medium");
    assert_eq!(Confidence::Low.to_string(), "low");
}

#[test]
fn test_verdict_from_string() {
    assert_eq!(Verdict::from_string("requested"), Verdict::Requested);
    assert_eq!(Verdict::from_string("allowed"), Verdict::Allowed);
    assert_eq!(Verdict::from_string("denied"), Verdict::Denied);
    assert_eq!(Verdict::from_string("ALLOWED"), Verdict::Allowed);
    assert_eq!(Verdict::from_string(""), Verdict::None);
    assert_eq!(Verdict::from_string("unknown"), Verdict::None);
}

#[test]
fn test_meeting_signal_default() {
    let signal = MeetingSignal::default();
    assert_eq!(signal.event, "meeting_signal");
    assert!(signal.timestamp.is_empty());
    assert!(!signal.camera_active);
    assert!(signal.chrome_url.is_none());
}

#[test]
fn test_lifecycle_event_meeting_started() {
    let event = MeetingLifecycleEvent::meeting_started(
        MeetingPlatform::Zoom,
        Confidence::High,
    );
    
    assert_eq!(event.event, "meeting_started");
    assert_eq!(event.platform, "Zoom");
    assert_eq!(event.confidence, "high");
    assert!(event.previous_platform.is_none());
    assert!(!event.timestamp.is_empty());
}

#[test]
fn test_lifecycle_event_meeting_changed() {
    let event = MeetingLifecycleEvent::meeting_changed(
        MeetingPlatform::GoogleMeet,
        MeetingPlatform::Zoom,
        Confidence::Medium,
    );
    
    assert_eq!(event.event, "meeting_changed");
    assert_eq!(event.platform, "Google Meet");
    assert_eq!(event.previous_platform, Some("Zoom".to_string()));
    assert_eq!(event.reason, "switch");
}

#[test]
fn test_lifecycle_event_meeting_ended() {
    let event = MeetingLifecycleEvent::meeting_ended(
        MeetingPlatform::MicrosoftTeams,
        Confidence::High,
        LifecycleReason::Timeout,
    );
    
    assert_eq!(event.event, "meeting_ended");
    assert_eq!(event.platform, "Microsoft Teams");
    assert_eq!(event.reason, "timeout");
    
    let event2 = MeetingLifecycleEvent::meeting_ended(
        MeetingPlatform::Slack,
        Confidence::Low,
        LifecycleReason::Stop,
    );
    assert_eq!(event2.reason, "stop");
}

#[test]
fn test_detector_options_default() {
    let opts = DetectorOptions::default();
    
    assert_eq!(opts.debug, Some(false));
    assert_eq!(opts.session_deduplication_ms, Some(60000));
    assert_eq!(opts.meeting_end_timeout_ms, Some(30000));
    assert_eq!(opts.emit_unknown, Some(false));
    assert_eq!(opts.startup_probe, Some(true));
}
