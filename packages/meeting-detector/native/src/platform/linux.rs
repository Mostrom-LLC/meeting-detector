//! Linux platform detection using PulseAudio and X11.
//!
//! Detection methods:
//! - PulseAudio/PipeWire for audio routing
//! - X11 for window info (Wayland not supported)
//!
//! Note: Wayland is not supported due to security restrictions that prevent
//! window inspection by design.

use crate::error::{DetectorError, DetectorResult};
use crate::types::MeetingSignal;
use crate::platform::PlatformDetector;
use std::time::Duration;

/// Linux meeting detector implementation.
#[derive(Debug)]
pub struct LinuxDetector {
    /// Debug logging enabled
    debug: bool,
    /// Whether we're running under X11
    has_x11: bool,
}

impl LinuxDetector {
    /// Create a new Linux detector.
    pub fn new() -> DetectorResult<Self> {
        // Check if X11 is available
        let has_x11 = std::env::var("DISPLAY").is_ok();

        Ok(Self {
            debug: false,
            has_x11,
        })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Get the active window info using X11.
    fn get_active_window_x11(&self) -> Option<(String, String, u32)> {
        if !self.has_x11 {
            return None;
        }

        // TODO: Implement using x11rb
        // Returns (window_title, wm_class, pid)
        None
    }

    /// Get processes using audio capture via PulseAudio.
    fn get_audio_capture_processes(&self) -> Vec<(u32, String)> {
        // TODO: Implement using libpulse-binding
        // Returns list of (pid, app_name) with active recording streams
        Vec::new()
    }

    /// Check if camera is in use.
    fn is_camera_in_use(&self) -> bool {
        // Check /dev/video* device usage or v4l2 API
        // TODO: Implement
        false
    }

    /// Get process name by PID.
    fn get_process_name(&self, pid: u32) -> Option<String> {
        std::fs::read_to_string(format!("/proc/{}/comm", pid))
            .ok()
            .map(|s| s.trim().to_string())
    }

    /// Get process command line by PID.
    fn get_process_cmdline(&self, pid: u32) -> Option<String> {
        std::fs::read_to_string(format!("/proc/{}/cmdline", pid))
            .ok()
            .map(|s| s.replace('\0', " ").trim().to_string())
    }
}

impl PlatformDetector for LinuxDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Check for camera/mic activity
        let camera_active = self.is_camera_in_use();
        let audio_procs = self.get_audio_capture_processes();

        if !camera_active && audio_procs.is_empty() {
            return Ok(None);
        }

        // Get context about the active window (X11 only)
        let (window_title, front_app, pid) = self
            .get_active_window_x11()
            .unwrap_or_default();

        // Create signal
        let signal = MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: front_app.clone(),
            verdict: String::new(),
            preflight: false,
            process: front_app.clone(),
            pid: pid.to_string(),
            parent_pid: String::new(),
            process_path: String::new(),
            front_app,
            window_title,
            session_id: String::new(),
            camera_active,
            chrome_url: None,
        };

        Ok(Some(signal))
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        if !self.has_x11 {
            // Running under Wayland - limited functionality
            if self.debug {
                eprintln!("Warning: Running under Wayland. Window inspection is not supported.");
            }
        }
        Ok(())
    }

    fn platform_name(&self) -> &'static str {
        "Linux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linux_detector_creation() {
        let detector = LinuxDetector::new().unwrap();
        assert_eq!(detector.platform_name(), "Linux");
    }

    #[test]
    fn test_get_process_name() {
        let detector = LinuxDetector::new().unwrap();
        // Current process should be "cargo" or similar
        let name = detector.get_process_name(std::process::id());
        assert!(name.is_some());
    }
}
