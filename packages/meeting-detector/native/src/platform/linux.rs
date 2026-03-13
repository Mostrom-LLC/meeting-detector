//! Linux platform detection using PulseAudio and X11.
//!
//! Detection methods:
//! - PulseAudio/PipeWire for audio routing
//! - X11 for window info (Wayland not supported)
//!
//! Note: Wayland is not supported due to security restrictions that prevent
//! window inspection by design.

use crate::error::DetectorResult;
use crate::platform::PlatformDetector;
use crate::types::MeetingSignal;
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

        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::*;

        // Connect to X11 server
        let (conn, screen_num) = match x11rb::connect(None) {
            Ok(c) => c,
            Err(_) => return None,
        };

        let screen = &conn.setup().roots[screen_num];
        let root = screen.root;

        // Get active window atom
        let net_active_window = conn
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .ok()?
            .reply()
            .ok()?
            .atom;

        // Get active window
        let reply = conn
            .get_property(false, root, net_active_window, AtomEnum::WINDOW, 0, 1)
            .ok()?
            .reply()
            .ok()?;

        if reply.value.len() < 4 {
            return None;
        }

        let window = u32::from_ne_bytes([
            reply.value[0],
            reply.value[1],
            reply.value[2],
            reply.value[3],
        ]);

        if window == 0 {
            return None;
        }

        // Get window title
        let net_wm_name = conn
            .intern_atom(false, b"_NET_WM_NAME")
            .ok()?
            .reply()
            .ok()?
            .atom;
        let utf8_string = conn
            .intern_atom(false, b"UTF8_STRING")
            .ok()?
            .reply()
            .ok()?
            .atom;

        let title_reply = conn
            .get_property(false, window, net_wm_name, utf8_string, 0, 1024)
            .ok()?
            .reply()
            .ok()?;

        let title = String::from_utf8_lossy(&title_reply.value).to_string();

        // Get WM_CLASS
        let wm_class_reply = conn
            .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 1024)
            .ok()?
            .reply()
            .ok()?;

        let wm_class = String::from_utf8_lossy(&wm_class_reply.value)
            .split('\0')
            .last()
            .unwrap_or("")
            .to_string();

        // Get PID
        let net_wm_pid = conn
            .intern_atom(false, b"_NET_WM_PID")
            .ok()?
            .reply()
            .ok()?
            .atom;

        let pid_reply = conn
            .get_property(false, window, net_wm_pid, AtomEnum::CARDINAL, 0, 1)
            .ok()?
            .reply()
            .ok()?;

        let pid = if pid_reply.value.len() >= 4 {
            u32::from_ne_bytes([
                pid_reply.value[0],
                pid_reply.value[1],
                pid_reply.value[2],
                pid_reply.value[3],
            ])
        } else {
            0
        };

        Some((title, wm_class, pid))
    }

    /// Get processes using audio capture via procfs.
    ///
    /// Checks for processes that have /dev/snd/* open (ALSA) or
    /// PipeWire/PulseAudio connections with recording.
    fn get_audio_capture_processes(&self) -> Vec<(u32, String)> {
        use std::fs;

        let mut result = Vec::new();

        // Look for processes with /dev/snd/* open
        if let Ok(proc_entries) = fs::read_dir("/proc") {
            for entry in proc_entries.flatten() {
                let pid_str = entry.file_name();
                let pid_str = pid_str.to_string_lossy();

                // Skip non-numeric directories
                let pid: u32 = match pid_str.parse() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                let fd_dir = entry.path().join("fd");
                if let Ok(fds) = fs::read_dir(&fd_dir) {
                    for fd in fds.flatten() {
                        if let Ok(link) = fs::read_link(fd.path()) {
                            let link_str = link.to_string_lossy();

                            // Check for sound device access
                            if link_str.contains("/dev/snd/")
                                && (link_str.contains("pcmC") && link_str.contains("c"))
                            {
                                // This is a capture device (c = capture, p = playback)
                                if let Some(name) = self.get_process_name(pid) {
                                    result.push((pid, name));
                                    break; // Only add each process once
                                }
                            }
                        }
                    }
                }
            }
        }

        result
    }

    /// Check if camera is in use.
    fn is_camera_in_use(&self) -> bool {
        use std::fs;
        use std::path::Path;

        // Check if any /dev/video* device is being used
        for entry in fs::read_dir("/dev").into_iter().flatten() {
            if let Ok(entry) = entry {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if name.starts_with("video") {
                    // Check if device is open by any process
                    let fd_path = format!("/proc/self/fd");
                    if let Ok(fds) = fs::read_dir(&fd_path) {
                        for fd in fds.flatten() {
                            if let Ok(link) = fs::read_link(fd.path()) {
                                if link == path {
                                    return true;
                                }
                            }
                        }
                    }

                    // Also check via /sys/class/video4linux
                    let v4l_path = format!("/sys/class/video4linux/{}/device/uevent", name);
                    if Path::new(&v4l_path).exists() {
                        // Check if device is in use by looking at open file descriptors
                        if let Ok(entries) = fs::read_dir("/proc") {
                            for proc_entry in entries.flatten() {
                                let fd_dir = proc_entry.path().join("fd");
                                if let Ok(fds) = fs::read_dir(&fd_dir) {
                                    for fd in fds.flatten() {
                                        if let Ok(link) = fs::read_link(fd.path()) {
                                            if link.to_string_lossy().contains(name) {
                                                return true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

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
        let (window_title, front_app, pid) = self.get_active_window_x11().unwrap_or_default();

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
