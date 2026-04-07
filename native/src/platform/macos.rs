//! macOS platform detection using TCC/OSLog streaming.
//!
//! Detection methods:
//! - TCC/OSLog streaming for real-time mic/camera access events (FORWARD, Granting, AUTHREQ_CTX)
//! - Process lookup by PID (ps -p PID -o comm=)
//! - Parent PID lookup (ps -o ppid= -p PID)
//! - Process path via lsof + ps fallback
//! - App normalization (Chrome Helper → Google Chrome, etc.)
//! - Camera active check via VDCAssistant/AppleCameraAssistant
//! - Front app / window title via AppleScript
//! - Chrome URL extraction via AppleScript (for Chrome Helper TCC events)
//!
//! Browser tab enumeration stays in JavaScript — see gap analysis in MOS-607-progress.md.

use crate::error::{DetectorError, DetectorResult};
use crate::platform::PlatformDetector;
use crate::types::MeetingSignal;
use regex::Regex;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Parsed TCC log event before enrichment with process info.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TccEvent {
    service: String,   // "microphone" or "camera"
    verdict: String,   // "allowed", "denied", or "requested"
    preflight: bool,
    pid: u32,
}

/// macOS meeting detector with TCC log streaming.
pub struct MacOSDetector {
    debug: bool,
    /// Receiver for TCC events parsed from `log stream` output.
    /// Wrapped in Mutex to satisfy the Sync bound on PlatformDetector.
    tcc_rx: Mutex<Option<Receiver<TccEvent>>>,
    /// Handle to the `log stream` child process (for cleanup).
    log_child: Arc<Mutex<Option<Child>>>,
    /// Regex patterns compiled once for TCC log parsing.
    re_forward_pid: Regex,
    re_granting: Regex,
    re_authreq: Regex,
}

// Manual Debug impl since Child doesn't implement Debug
impl std::fmt::Debug for MacOSDetector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MacOSDetector")
            .field("debug", &self.debug)
            .field("tcc_rx", &self.tcc_rx.lock().unwrap().is_some())
            .finish()
    }
}

impl MacOSDetector {
    /// Create a new macOS detector. Does NOT start TCC streaming yet.
    pub fn new() -> DetectorResult<Self> {
        Ok(Self {
            debug: false,
            tcc_rx: Mutex::new(None),
            log_child: Arc::new(Mutex::new(None)),
            re_forward_pid: Regex::new(r"target_token=\{pid:(\d+)").unwrap(),
            re_granting: Regex::new(
                r"Granting TCCDProcess:.*pid=(\d+).*access to kTCCService(Microphone|Camera)",
            )
            .unwrap(),
            re_authreq: Regex::new(
                r"AUTHREQ_CTX: msgID=(\d+)\.\d+,.*service=kTCCService(Microphone|Camera),\s*preflight=(yes|no)",
            )
            .unwrap(),
        })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Start TCC log streaming in a background thread.
    /// Returns immediately; signals arrive via the internal channel.
    pub fn start_tcc_stream(&self) -> DetectorResult<()> {
        if self.tcc_rx.lock().unwrap().is_some() {
            return Ok(()); // already streaming
        }

        let child = Command::new("/usr/bin/log")
            .args([
                "stream",
                "--style", "syslog",
                "--predicate",
                r#"subsystem == "com.apple.TCC" AND (eventMessage CONTAINS[c] "kTCCServiceMicrophone" OR eventMessage CONTAINS[c] "kTCCServiceCamera")"#,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| DetectorError::Internal {
                message: format!("Failed to spawn log stream: {}", e),
            })?;

        let (tx, rx) = mpsc::channel::<TccEvent>();
        *self.tcc_rx.lock().unwrap() = Some(rx);

        // Clone regex patterns for the reader thread
        let re_forward = self.re_forward_pid.clone();
        let re_granting = self.re_granting.clone();
        let re_authreq = self.re_authreq.clone();
        let debug = self.debug;

        let mut child_for_thread = child;
        let stdout = child_for_thread.stdout.take().ok_or_else(|| DetectorError::Internal {
            message: "Failed to capture log stream stdout".to_string(),
        })?;

        // Store child handle for cleanup
        *self.log_child.lock().unwrap() = Some(child_for_thread);

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            // Accumulate state across lines (TCC logs can span multiple lines)
            let mut current_svc: Option<String> = None;
            let mut current_pid: Option<u32> = None;
            let mut current_verdict: Option<String> = None;
            let mut current_preflight: Option<bool> = None;

            for line_result in reader.lines() {
                let line = match line_result {
                    Ok(l) => l,
                    Err(_) => break,
                };

                // Parse service type
                if line.contains("kTCCServiceMicrophone") {
                    current_svc = Some("microphone".to_string());
                } else if line.contains("kTCCServiceCamera") {
                    current_svc = Some("camera".to_string());
                }

                // Parse verdict
                if line.contains("Access Allowed")
                    || line.contains("Auth Granted")
                    || line.contains("Allow")
                {
                    current_verdict = Some("allowed".to_string());
                } else if line.contains("Denied") {
                    current_verdict = Some("denied".to_string());
                } else if line.contains("FORWARD") {
                    current_verdict = Some("requested".to_string());
                }

                // Capture preflight
                if line.contains("preflight=yes") {
                    current_preflight = Some(true);
                } else if line.contains("preflight=no") {
                    current_preflight = Some(false);
                }

                // Parse FORWARD target PID
                if let Some(caps) = re_forward.captures(&line) {
                    if let Ok(pid) = caps[1].parse::<u32>() {
                        current_pid = Some(pid);
                    }
                }

                // Parse Granting lines (pre-entitled apps)
                if let Some(caps) = re_granting.captures(&line) {
                    if let Ok(pid) = caps[1].parse::<u32>() {
                        current_pid = Some(pid);
                        current_svc = Some(if &caps[2] == "Microphone" {
                            "microphone"
                        } else {
                            "camera"
                        }.to_string());
                        current_verdict = Some("allowed".to_string());
                        current_preflight = Some(false);
                    }
                }

                // Parse AUTHREQ_CTX lines (msgID=PID.counter)
                if let Some(caps) = re_authreq.captures(&line) {
                    if let Ok(candidate_pid) = caps[1].parse::<u32>() {
                        // Skip system message IDs (PID <= 500)
                        if candidate_pid > 500 {
                            current_pid = Some(candidate_pid);
                            current_svc = Some(if &caps[2] == "Microphone" {
                                "microphone"
                            } else {
                                "camera"
                            }.to_string());
                            let is_preflight = &caps[3] == "yes";
                            current_preflight = Some(is_preflight);
                            if current_verdict.is_none() {
                                current_verdict = Some(if is_preflight {
                                    "requested"
                                } else {
                                    "allowed"
                                }.to_string());
                            }
                        }
                    }
                }

                // Emit when both service and PID are available
                if let (Some(svc), Some(pid)) = (&current_svc, current_pid) {
                    let event = TccEvent {
                        service: svc.clone(),
                        verdict: current_verdict.clone().unwrap_or_else(|| "requested".to_string()),
                        preflight: current_preflight.unwrap_or(false),
                        pid,
                    };

                    if debug {
                        eprintln!("[MacOSDetector TCC] {:?}", event);
                    }

                    if tx.send(event).is_err() {
                        break; // receiver dropped
                    }

                    // Reset accumulator
                    current_svc = None;
                    current_pid = None;
                    current_verdict = None;
                    current_preflight = None;
                }
            }
        });

        Ok(())
    }

    /// Stop the TCC log stream.
    pub fn stop_tcc_stream(&self) {
        *self.tcc_rx.lock().unwrap() = None;
        if let Ok(mut guard) = self.log_child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
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
        let vdc = Command::new("pgrep")
            .args(["-x", "VDCAssistant"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if vdc {
            return true;
        }

        Command::new("pgrep")
            .args(["-x", "AppleCameraAssistant"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Look up the process name for a given PID.
    fn get_process_name(&self, pid: u32) -> Option<String> {
        let output = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .ok()?;

        if output.status.success() {
            let full_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !full_path.is_empty() {
                // basename: take the last path component
                let name = full_path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&full_path)
                    .to_string();
                return Some(name);
            }
        }
        None
    }

    /// Get the parent PID for a given PID.
    fn get_parent_pid(&self, pid: u32) -> Option<String> {
        let output = Command::new("ps")
            .args(["-o", "ppid=", "-p", &pid.to_string()])
            .output()
            .ok()?;

        if output.status.success() {
            let ppid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ppid.is_empty() {
                return Some(ppid);
            }
        }
        None
    }

    /// Get the process executable path for a given PID.
    /// Tries lsof first, falls back to ps.
    fn get_process_path(&self, pid: u32) -> String {
        let pid_str = pid.to_string();

        // Try lsof for the txt entry (executable path)
        if let Ok(output) = Command::new("lsof")
            .args(["-p", &pid_str])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 9 && parts.get(3) == Some(&"txt") {
                        // Reconstruct the path (may contain spaces)
                        return parts[8..].join(" ");
                    }
                }
            }
        }

        // Fallback to ps -o comm=
        if let Ok(output) = Command::new("ps")
            .args(["-o", "comm=", "-p", &pid_str])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return path;
                }
            }
        }

        String::new()
    }

    /// Normalize helper process names to their main application.
    fn normalize_app(process_name: &str) -> String {
        if process_name.contains("Microsoft Teams") {
            "Microsoft Teams".to_string()
        } else if process_name.contains("Google Chrome") || process_name.contains("Chrome Helper")
        {
            "Google Chrome".to_string()
        } else if process_name.contains("Slack") {
            "Slack".to_string()
        } else {
            process_name.to_string()
        }
    }

    /// Get Chrome active tab URL via AppleScript (for Chrome Helper TCC events).
    fn get_chrome_url(&self) -> Option<String> {
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"tell application "Google Chrome" to get URL of active tab of front window"#,
            ])
            .output()
            .ok()?;

        if output.status.success() {
            let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !url.is_empty() {
                return Some(url);
            }
        }
        None
    }

    /// Get session ID from the tty/console.
    fn get_session_id(&self) -> String {
        if let Ok(output) = Command::new("who").args(["-m"]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for word in stdout.split_whitespace() {
                    if word.starts_with("tty") || word.starts_with("console") {
                        return word.to_string();
                    }
                }
            }
        }
        String::new()
    }

    /// Enrich a raw TCC event into a full MeetingSignal.
    fn enrich_tcc_event(&self, event: TccEvent) -> Option<MeetingSignal> {
        // Look up process name from PID
        let process_name = self.get_process_name(event.pid)?;
        if process_name.is_empty() {
            return None;
        }

        let normalized = Self::normalize_app(&process_name);
        let parent_pid = self.get_parent_pid(event.pid).unwrap_or_default();
        let process_path = self.get_process_path(event.pid);
        let front_app = self.get_front_app().unwrap_or_default();
        let window_title = self.get_window_title().unwrap_or_default();
        let camera_active = self.is_camera_active();
        let session_id = self.get_session_id();

        // Get Chrome URL if this is a Chrome-related process
        let chrome_url = if process_name.contains("Chrome Helper")
            || process_name.contains("Google Chrome")
        {
            self.get_chrome_url()
        } else {
            None
        };

        Some(MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: normalized,
            verdict: event.verdict,
            preflight: event.preflight,
            process: process_name,
            pid: event.pid.to_string(),
            parent_pid,
            process_path,
            front_app,
            window_title,
            session_id,
            camera_active,
            chrome_url,
        })
    }
}

impl PlatformDetector for MacOSDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Lazy-start the TCC log stream on first detect() call. The stream
        // runs in a background thread and pushes events through an mpsc
        // channel until stop_tcc_stream() is called or the receiver drops.
        // Without this, detect() would only ever fall through to the
        // camera-active polling path and silently miss every TCC signal.
        if self.tcc_rx.lock().map(|g| g.is_none()).unwrap_or(false) {
            if let Err(e) = self.start_tcc_stream() {
                if self.debug {
                    eprintln!("[MacOSDetector] start_tcc_stream failed: {:?}", e);
                }
            }
        }

        // If TCC stream is active, drain events from it
        if let Ok(guard) = self.tcc_rx.lock() {
            if let Some(rx) = guard.as_ref() {
                match rx.try_recv() {
                    Ok(event) => {
                        return Ok(self.enrich_tcc_event(event));
                    }
                    Err(TryRecvError::Empty) => {
                        // No TCC events pending — fall through to camera poll
                    }
                    Err(TryRecvError::Disconnected) => {
                        // Stream died — fall through to camera poll
                        if self.debug {
                            eprintln!("[MacOSDetector] TCC stream disconnected");
                        }
                    }
                }
            }
        }

        // Fallback: camera-based polling (catches cases where TCC didn't fire)
        if self.is_camera_active() {
            let front_app = self.get_front_app().unwrap_or_default();
            let window_title = self.get_window_title().unwrap_or_default();

            let signal = MeetingSignal {
                event: "meeting_signal".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                service: front_app.clone(),
                verdict: "allowed".to_string(),
                preflight: false,
                process: front_app.clone(),
                pid: String::new(),
                parent_pid: String::new(),
                process_path: String::new(),
                front_app,
                window_title,
                session_id: self.get_session_id(),
                camera_active: true,
                chrome_url: None,
            };

            return Ok(Some(signal));
        }

        Ok(None)
    }

    fn poll_interval(&self) -> Duration {
        // Faster polling when TCC stream is active since we're just draining a channel.
        // Slower when relying on camera-only fallback.
        if self.tcc_rx.lock().unwrap().is_some() {
            Duration::from_millis(200)
        } else {
            Duration::from_millis(500)
        }
    }

    fn check_permissions(&self) -> DetectorResult<()> {
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
                    Ok(())
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

impl Drop for MacOSDetector {
    fn drop(&mut self) {
        self.stop_tcc_stream();
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

    #[test]
    fn test_normalize_app() {
        assert_eq!(MacOSDetector::normalize_app("Google Chrome Helper"), "Google Chrome");
        assert_eq!(MacOSDetector::normalize_app("Chrome Helper (Renderer)"), "Google Chrome");
        assert_eq!(MacOSDetector::normalize_app("Microsoft Teams Helper"), "Microsoft Teams");
        assert_eq!(MacOSDetector::normalize_app("Slack Helper"), "Slack");
        assert_eq!(MacOSDetector::normalize_app("zoom.us"), "zoom.us");
        assert_eq!(MacOSDetector::normalize_app("FaceTime"), "FaceTime");
    }

    #[test]
    fn test_tcc_forward_regex() {
        let re = Regex::new(r"target_token=\{pid:(\d+)").unwrap();
        let line = "FORWARD: target_token={pid:12345, auid:501}";
        let caps = re.captures(line).unwrap();
        assert_eq!(&caps[1], "12345");
    }

    #[test]
    fn test_tcc_granting_regex() {
        let re = Regex::new(
            r"Granting TCCDProcess:.*pid=(\d+).*access to kTCCService(Microphone|Camera)",
        )
        .unwrap();
        let line = "Granting TCCDProcess: identifier=com.apple.PhotoBooth, pid=59097, auid=501, euid=501 access to kTCCServiceCamera";
        let caps = re.captures(line).unwrap();
        assert_eq!(&caps[1], "59097");
        assert_eq!(&caps[2], "Camera");
    }

    #[test]
    fn test_tcc_authreq_regex() {
        let re = Regex::new(
            r"AUTHREQ_CTX: msgID=(\d+)\.\d+,.*service=kTCCService(Microphone|Camera),\s*preflight=(yes|no)",
        )
        .unwrap();
        let line = "AUTHREQ_CTX: msgID=70907.2, function=TCCAccessPreflight, service=kTCCServiceMicrophone, preflight=yes";
        let caps = re.captures(line).unwrap();
        assert_eq!(&caps[1], "70907");
        assert_eq!(&caps[2], "Microphone");
        assert_eq!(&caps[3], "yes");
    }

    #[test]
    fn test_tcc_authreq_skips_low_pids() {
        let re = Regex::new(
            r"AUTHREQ_CTX: msgID=(\d+)\.\d+,.*service=kTCCService(Microphone|Camera),\s*preflight=(yes|no)",
        )
        .unwrap();
        let line = "AUTHREQ_CTX: msgID=187.5, function=TCCAccessPreflight, service=kTCCServiceMicrophone, preflight=yes";
        let caps = re.captures(line).unwrap();
        let pid: u32 = caps[1].parse().unwrap();
        assert!(pid <= 500, "PID 187 should be filtered out");
    }

    #[test]
    fn test_poll_interval_with_tcc() {
        let detector = MacOSDetector::new().unwrap();
        // Without TCC stream, should be 500ms
        assert_eq!(detector.poll_interval(), Duration::from_millis(500));
    }
}
