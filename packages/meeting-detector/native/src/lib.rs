//! meeting-detector native Rust core.
//!
//! This crate provides cross-platform meeting detection via napi-rs.
//!
//! # Architecture
//!
//! - `types`: Core type definitions (MeetingPlatform, MeetingSignal, etc.)
//! - `error`: Error types and handling
//! - `platform`: Platform-specific detection implementations
//! - `matchers`: Platform identification from process/window info
//! - `detector`: State machine for lifecycle management
//!
//! # Usage from JavaScript
//!
//! ```javascript
//! const { NativeMeetingDetector } = require('@mostrom/meeting-detector');
//!
//! const detector = new NativeMeetingDetector();
//! detector.onLifecycleEvent((event) => {
//!     console.log(event);
//! });
//! detector.start();
//! ```

#[macro_use]
extern crate napi_derive;

pub mod detector;
pub mod error;
pub mod matchers;
pub mod platform;
pub mod types;

use napi::Result as NapiResult;
use std::sync::{Arc, Mutex};

// Re-export types for napi
pub use error::*;
pub use types::*;

/// Native meeting detector class exposed to JavaScript.
#[napi]
pub struct NativeMeetingDetector {
    #[allow(dead_code)]
    config: detector::DetectorConfig,
    state_machine: Arc<Mutex<detector::DetectorStateMachine>>,
    running: Arc<Mutex<bool>>,
}

#[napi]
impl NativeMeetingDetector {
    /// Create a new detector with optional configuration.
    #[napi(constructor)]
    pub fn new(options: Option<DetectorOptions>) -> Self {
        let config: detector::DetectorConfig = options.unwrap_or_default().into();

        let state_machine = detector::DetectorStateMachine::new(config.clone());

        Self {
            config,
            state_machine: Arc::new(Mutex::new(state_machine)),
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// Start the detector.
    ///
    /// On supported platforms, this begins monitoring for meeting activity.
    #[napi]
    pub fn start(&self) -> NapiResult<()> {
        let mut running = self.running.lock().unwrap();
        if *running {
            return Err(error::DetectorError::AlreadyRunning.into());
        }
        *running = true;

        // TODO: Start platform-specific detection
        // This will be implemented in platform modules

        Ok(())
    }

    /// Stop the detector.
    #[napi]
    pub fn stop(&self) -> NapiResult<Option<MeetingLifecycleEvent>> {
        let mut running = self.running.lock().unwrap();
        if !*running {
            return Err(error::DetectorError::NotRunning.into());
        }
        *running = false;

        // Emit meeting_ended if active
        let mut machine = self.state_machine.lock().unwrap();
        Ok(machine.on_stop())
    }

    /// Check if the detector is currently running.
    #[napi]
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }

    /// Get the current platform name.
    #[napi]
    pub fn platform_name(&self) -> String {
        #[cfg(target_os = "macos")]
        return "macOS".to_string();

        #[cfg(target_os = "windows")]
        return "Windows".to_string();

        #[cfg(target_os = "linux")]
        return "Linux".to_string();

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        return "Unknown".to_string();
    }

    /// Check if the current platform is supported.
    #[napi]
    pub fn is_supported(&self) -> bool {
        cfg!(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux"
        ))
    }

    /// Process a signal (for testing or manual signal injection).
    #[napi]
    pub fn process_signal(&self, signal: MeetingSignal) -> Vec<MeetingLifecycleEvent> {
        let mut machine = self.state_machine.lock().unwrap();
        machine.process_signal(signal)
    }

    /// Check for meeting end timeout.
    #[napi]
    pub fn check_meeting_end(&self) -> Option<MeetingLifecycleEvent> {
        let mut machine = self.state_machine.lock().unwrap();
        machine.check_meeting_end()
    }

    /// Clean up old sessions.
    #[napi]
    pub fn cleanup_sessions(&self) {
        let mut machine = self.state_machine.lock().unwrap();
        machine.cleanup_sessions();
    }
}

/// Match a platform from the given context.
///
/// This is a standalone function for testing matchers.
#[napi]
pub fn match_platform(
    process_name: String,
    window_title: String,
    url: Option<String>,
    camera_active: Option<bool>,
) -> String {
    let mut ctx = matchers::MatchContext::new(process_name, window_title)
        .with_camera_active(camera_active.unwrap_or(false));

    if let Some(u) = url {
        ctx = ctx.with_url(u);
    }

    let registry = matchers::MatcherRegistry::new();
    registry.match_platform(&ctx).to_string()
}

/// Get the version of the native module.
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get supported platforms as an array.
#[napi]
pub fn supported_platforms() -> Vec<String> {
    vec![
        "Microsoft Teams".to_string(),
        "Zoom".to_string(),
        "Google Meet".to_string(),
        "Slack".to_string(),
        "Cisco Webex".to_string(),
        "Discord".to_string(),
        "FaceTime".to_string(),
        "Skype".to_string(),
        "Whereby".to_string(),
        "GoToMeeting".to_string(),
        "BlueJeans".to_string(),
        "Jitsi Meet".to_string(),
        "8x8".to_string(),
        "RingCentral".to_string(),
        "BigBlueButton".to_string(),
        "Amazon Chime".to_string(),
        "Google Hangouts".to_string(),
        "Adobe Connect".to_string(),
        "TeamViewer".to_string(),
        "AnyDesk".to_string(),
        "ClickMeeting".to_string(),
        "Appear.in".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!version().is_empty());
    }

    #[test]
    fn test_supported_platforms() {
        let platforms = supported_platforms();
        assert!(!platforms.is_empty());
        assert!(platforms.contains(&"Zoom".to_string()));
    }

    #[test]
    fn test_match_platform_function() {
        let result = match_platform(
            "Zoom".to_string(),
            "Zoom Meeting".to_string(),
            None,
            Some(true),
        );
        assert_eq!(result, "Zoom");
    }

    #[test]
    fn test_detector_creation() {
        let detector = NativeMeetingDetector::new(None);
        assert!(!detector.is_running());
        assert!(detector.is_supported());
    }
}
