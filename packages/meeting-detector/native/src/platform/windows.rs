//! Windows platform detection using PowerShell commands and registry queries.
//!
//! Detection methods:
//! - Registry queries for camera/mic access
//! - PowerShell for active window info
//! - Process enumeration for meeting apps

use crate::error::{DetectorError, DetectorResult};
use crate::types::MeetingSignal;
use crate::platform::PlatformDetector;
use std::process::Command;
use std::time::Duration;

/// Windows meeting detector implementation.
#[derive(Debug)]
pub struct WindowsDetector {
    /// Debug logging enabled
    debug: bool,
}

impl WindowsDetector {
    /// Create a new Windows detector.
    pub fn new() -> DetectorResult<Self> {
        Ok(Self { debug: false })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Get the foreground window title and process using PowerShell.
    fn get_foreground_window_info(&self) -> Option<(String, String, u32)> {
        // PowerShell command to get foreground window info
        let script = r#"
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class Win32 {
                [DllImport("user32.dll")]
                public static extern IntPtr GetForegroundWindow();
                [DllImport("user32.dll")]
                public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                [DllImport("user32.dll", SetLastError=true)]
                public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
            }
"@
            $hwnd = [Win32]::GetForegroundWindow()
            $sb = New-Object System.Text.StringBuilder 256
            [void][Win32]::GetWindowText($hwnd, $sb, 256)
            $pid = 0
            [void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            "$($sb.ToString())|$($proc.ProcessName)|$pid"
        "#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()
            .ok()?;

        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = result.split('|').collect();
            if parts.len() >= 3 {
                let title = parts[0].to_string();
                let process = parts[1].to_string();
                let pid: u32 = parts[2].parse().unwrap_or(0);
                return Some((title, process, pid));
            }
        }
        None
    }

    /// Check if camera is in use by querying the registry.
    fn is_camera_in_use(&self) -> bool {
        // Check registry for camera usage
        // HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam
        let script = r#"
            $inUse = $false
            $camPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam"
            if (Test-Path $camPath) {
                Get-ChildItem $camPath -ErrorAction SilentlyContinue | ForEach-Object {
                    $lastUsed = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).LastUsedTimeStop
                    if ($lastUsed -eq 0) { $inUse = $true }
                }
            }
            if ($inUse) { "true" } else { "false" }
        "#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output();

        output
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false)
    }

    /// Check if microphone is in use by querying the registry.
    fn is_mic_in_use(&self) -> bool {
        let script = r#"
            $inUse = $false
            $micPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
            if (Test-Path $micPath) {
                Get-ChildItem $micPath -ErrorAction SilentlyContinue | ForEach-Object {
                    $lastUsed = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).LastUsedTimeStop
                    if ($lastUsed -eq 0) { $inUse = $true }
                }
            }
            if ($inUse) { "true" } else { "false" }
        "#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output();

        output
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false)
    }

    /// Check if any known meeting app is running.
    fn find_meeting_process(&self) -> Option<(String, u32)> {
        let apps = [
            "Teams", "Zoom", "Webex", "Slack", "Discord", "Skype"
        ];
        
        for app in apps {
            let output = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!("Get-Process -Name '*{}*' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id", app)
                ])
                .output()
                .ok()?;

            if output.status.success() {
                let pid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if let Ok(pid) = pid_str.parse::<u32>() {
                    return Some((app.to_string(), pid));
                }
            }
        }
        None
    }
}

impl PlatformDetector for WindowsDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Check for camera/mic activity
        let camera_active = self.is_camera_in_use();
        let mic_active = self.is_mic_in_use();

        if !camera_active && !mic_active {
            return Ok(None);
        }

        // Get context about the active application
        let (window_title, front_app, pid) = self
            .get_foreground_window_info()
            .unwrap_or_default();

        // If foreground window isn't a meeting app, try to find one
        let (process_name, process_pid) = if let Some((meeting_app, meeting_pid)) = self.find_meeting_process() {
            (meeting_app, meeting_pid)
        } else {
            (front_app.clone(), pid)
        };

        // Generate session ID
        let session_id = format!(
            "{}-{}",
            process_name.to_lowercase(),
            chrono::Utc::now().timestamp()
        );

        // Determine verdict
        let verdict = if camera_active {
            "allowed".to_string()
        } else {
            "requested".to_string()
        };

        // Create signal
        let signal = MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: process_name.clone(),
            verdict,
            preflight: false,
            process: process_name.clone(),
            pid: process_pid.to_string(),
            parent_pid: String::new(),
            process_path: String::new(),
            front_app,
            window_title,
            session_id,
            camera_active,
            chrome_url: None,
        };

        if self.debug {
            eprintln!("[WindowsDetector] Signal: {:?}", signal);
        }

        Ok(Some(signal))
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        // Test PowerShell execution
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Write-Output 'ok'"])
            .output();

        match output {
            Ok(o) if o.status.success() => Ok(()),
            Ok(_) => Err(DetectorError::Internal {
                message: "PowerShell execution failed".to_string()
            }),
            Err(e) => Err(DetectorError::Internal {
                message: format!("PowerShell not available: {}", e)
            }),
        }
    }

    fn platform_name(&self) -> &'static str {
        "Windows"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_detector_creation() {
        let detector = WindowsDetector::new().unwrap();
        assert_eq!(detector.platform_name(), "Windows");
    }
}
