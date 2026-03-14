//! macOS platform detection using TCC logs, NSWorkspace, and AudioObject APIs.
//!
//! Detection methods:
//! - Process checks for VDCAssistant/AppleCameraAssistant (camera in use)
//! - AppleScript for frontmost application and window title
//! - TCC/OSLog streaming for real-time mic/camera events

use crate::error::{DetectorError, DetectorResult};
use crate::platform::PlatformDetector;
use crate::types::MeetingSignal;
use std::process::Command;
use std::time::Duration;

/// macOS meeting detector implementation.
#[derive(Debug)]
pub struct MacOSDetector {
    /// Debug logging enabled
    debug: bool,
}

impl MacOSDetector {
    /// Create a new macOS detector.
    pub fn new() -> DetectorResult<Self> {
        Ok(Self { debug: false })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Get the frontmost application name using AppleScript.
    fn get_front_app(&self) -> Option<String> {
        let output = Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to name of first application process whose frontmost is true"#])
            .output()
            .ok()?;

        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
        None
    }

    /// Get the window title of the frontmost application using AppleScript.
    fn get_window_title(&self) -> Option<String> {
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    tell frontApp
                        if (count of windows) > 0 then
                            return name of front window
                        end if
                    end tell
                end tell
                return ""
            "#,
            ])
            .output()
            .ok()?;

        if output.status.success() {
            let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !title.is_empty() {
                return Some(title);
            }
        }
        None
    }

    /// Check if camera is currently active by looking for camera daemon processes.
    fn is_camera_active(&self) -> bool {
        // VDCAssistant handles older Macs, AppleCameraAssistant handles newer ones
        let vdc = Command::new("pgrep")
            .args(["-x", "VDCAssistant"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if vdc {
            return true;
        }

        let apple_camera = Command::new("pgrep")
            .args(["-x", "AppleCameraAssistant"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        apple_camera
    }

    /// Check if microphone is currently active.
    /// Uses ioreg to check audio input device state.
    fn is_mic_active(&self) -> bool {
        // Check for processes with microphone access via coreaudiod
        // This is a heuristic - processes with audio input streams
        let output = Command::new("sh")
            .args([
                "-c",
                r#"
                ioreg -r -c AppleHDAEngineInput 2>/dev/null | grep -q '"IOAudioEngineState" = 1'
            "#,
            ])
            .output();

        output.map(|o| o.status.success()).unwrap_or(false)
    }

    /// Get process info for a known meeting app.
    fn get_meeting_process_info(&self, app_name: &str) -> Option<(String, String)> {
        // Try to get PID and path for the app
        let output = Command::new("pgrep").args(["-x", app_name]).output().ok()?;

        if output.status.success() {
            let pid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(first_pid) = pid.lines().next() {
                // Get process path
                let path_output = Command::new("ps")
                    .args(["-p", first_pid, "-o", "comm="])
                    .output()
                    .ok()?;

                let path = String::from_utf8_lossy(&path_output.stdout)
                    .trim()
                    .to_string();
                return Some((first_pid.to_string(), path));
            }
        }
        None
    }
}

impl PlatformDetector for MacOSDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Check for camera/mic activity
        let camera_active = self.is_camera_active();
        let mic_active = self.is_mic_active();

        // Need at least camera or mic active to consider it a meeting
        if !camera_active && !mic_active {
            return Ok(None);
        }

        // Get context about the active application
        let front_app = self.get_front_app().unwrap_or_default();
        let window_title = self.get_window_title().unwrap_or_default();

        // Try to get process info
        let (pid, process_path) = self
            .get_meeting_process_info(&front_app)
            .unwrap_or_default();

        // Generate a session ID based on app and timestamp
        let session_id = format!(
            "{}-{}",
            front_app.to_lowercase().replace(' ', "-"),
            chrono::Utc::now().timestamp()
        );

        // Determine verdict based on camera state
        let verdict = if camera_active {
            "allowed".to_string()
        } else {
            "requested".to_string()
        };

        // Create signal
        let signal = MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: front_app.clone(),
            verdict,
            preflight: false,
            process: front_app.clone(),
            pid,
            parent_pid: String::new(),
            process_path,
            front_app,
            window_title,
            session_id,
            camera_active,
            chrome_url: None,
        };

        if self.debug {
            eprintln!("[MacOSDetector] Signal: {:?}", signal);
        }

        Ok(Some(signal))
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        // Check if we can run AppleScript (requires accessibility permissions)
        let test = Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to return "ok""#])
            .output();

        match test {
            Ok(output) if output.status.success() => Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("not allowed") || stderr.contains("assistive") {
                    Err(DetectorError::PermissionDenied {
                        reason: "Accessibility permission required. Enable in System Preferences > Security & Privacy > Privacy > Accessibility".to_string()
                    })
                } else {
                    Ok(()) // Other errors might be transient
                }
            }
            Err(e) => Err(DetectorError::Internal {
                message: format!("Failed to check permissions: {}", e),
            }),
        }
    }

    fn platform_name(&self) -> &'static str {
        "macOS"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_macos_detector_creation() {
        let detector = MacOSDetector::new().unwrap();
        assert_eq!(detector.platform_name(), "macOS");
    }
}
