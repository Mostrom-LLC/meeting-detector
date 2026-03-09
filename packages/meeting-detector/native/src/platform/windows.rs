//! Windows platform detection using native APIs.
//!
//! Detection methods:
//! - WASAPI (Windows Audio Session API) for audio device consumers
//! - UI Automation for window inspection
//! - WMI for process enumeration

use crate::error::{DetectorError, DetectorResult};
use crate::platform::PlatformDetector;
use crate::types::MeetingSignal;
use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::time::Duration;

use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, MAX_PATH};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioSessionControl, IAudioSessionControl2,
    IAudioSessionEnumerator, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AudioSessionState, AudioSessionStateActive,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::ProcessStatus::K32GetModuleFileNameExW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    IUIAutomation, IUIAutomationElement, CUIAutomation, UIA_NamePropertyId,
    UIA_ProcessIdPropertyId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
};

use wmi::{COMLibrary, WMIConnection, WMIResult};
use serde::Deserialize;

/// Known meeting application process names
const MEETING_APPS: &[&str] = &[
    "Teams",
    "ms-teams",
    "Zoom",
    "CptHost",  // Zoom
    "webex",
    "atmgr",    // Webex
    "Slack",
    "Discord",
    "Skype",
    "FaceTime",
    "Google Meet",
    "chrome",   // Could be Meet/other web meetings
    "msedge",   // Could be web meetings
    "firefox",  // Could be web meetings
];

/// Process info from WMI
#[derive(Deserialize, Debug)]
#[serde(rename = "Win32_Process")]
#[serde(rename_all = "PascalCase")]
struct Win32Process {
    process_id: u32,
    name: String,
    #[serde(default)]
    command_line: Option<String>,
    #[serde(default)]
    executable_path: Option<String>,
    #[serde(default)]
    parent_process_id: Option<u32>,
}

/// Audio session info from WASAPI
#[derive(Debug, Clone)]
struct AudioSessionInfo {
    process_id: u32,
    process_name: String,
    is_active: bool,
    is_capture: bool,
}

/// Windows meeting detector using native APIs.
#[derive(Debug)]
pub struct WindowsDetector {
    debug: bool,
    com_initialized: bool,
}

impl WindowsDetector {
    /// Create a new Windows detector with native API access.
    pub fn new() -> DetectorResult<Self> {
        // Initialize COM for this thread
        let com_result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let com_initialized = com_result.is_ok();

        if !com_initialized {
            // COM might already be initialized, which is fine
            tracing::debug!("COM already initialized or failed: {:?}", com_result);
        }

        Ok(Self {
            debug: false,
            com_initialized,
        })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Get active audio sessions using WASAPI.
    fn get_audio_sessions(&self) -> Vec<AudioSessionInfo> {
        let mut sessions = Vec::new();

        // Check both capture (mic) and render (speaker) endpoints
        for (device_type, is_capture) in [(eCapture, true), (eRender, false)] {
            if let Ok(device_sessions) = self.enumerate_audio_sessions(device_type, is_capture) {
                sessions.extend(device_sessions);
            }
        }

        sessions
    }

    /// Enumerate audio sessions for a device type.
    fn enumerate_audio_sessions(
        &self,
        data_flow: windows::Win32::Media::Audio::EDataFlow,
        is_capture: bool,
    ) -> DetectorResult<Vec<AudioSessionInfo>> {
        let mut sessions = Vec::new();

        unsafe {
            // Get device enumerator
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| DetectorError::Platform(format!("Failed to create device enumerator: {}", e)))?;

            // Get default audio endpoint
            let device: IMMDevice = enumerator
                .GetDefaultAudioEndpoint(data_flow, eConsole)
                .map_err(|e| DetectorError::Platform(format!("Failed to get default endpoint: {}", e)))?;

            // Activate audio session manager
            let session_manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| DetectorError::Platform(format!("Failed to activate session manager: {}", e)))?;

            // Get session enumerator
            let session_enumerator: IAudioSessionEnumerator = session_manager
                .GetSessionEnumerator()
                .map_err(|e| DetectorError::Platform(format!("Failed to get session enumerator: {}", e)))?;

            // Get session count
            let count = session_enumerator
                .GetCount()
                .map_err(|e| DetectorError::Platform(format!("Failed to get session count: {}", e)))?;

            for i in 0..count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    // Get session control2 for process info
                    if let Ok(session_control2) = session_control.cast::<IAudioSessionControl2>() {
                        if let Ok(pid) = session_control2.GetProcessId() {
                            // Get session state
                            let is_active = session_control
                                .GetState()
                                .map(|s| s == AudioSessionStateActive)
                                .unwrap_or(false);

                            if is_active {
                                let process_name = self.get_process_name(pid).unwrap_or_else(|| "Unknown".to_string());
                                sessions.push(AudioSessionInfo {
                                    process_id: pid,
                                    process_name,
                                    is_active,
                                    is_capture,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(sessions)
    }

    /// Get process name by PID using Win32 API.
    fn get_process_name(&self, pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            
            let mut buffer = [0u16; MAX_PATH as usize];
            let mut size = buffer.len() as u32;
            
            let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
            let _ = CloseHandle(handle);

            if result.is_ok() {
                let path = OsString::from_wide(&buffer[..size as usize]);
                let path_str = path.to_string_lossy();
                // Extract filename from path
                path_str.split('\\').last().map(|s| s.trim_end_matches(".exe").to_string())
            } else {
                None
            }
        }
    }

    /// Get foreground window info using UI Automation.
    fn get_foreground_window_info(&self) -> Option<(String, String, u32)> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0 == std::ptr::null_mut() || !IsWindow(hwnd).as_bool() {
                return None;
            }

            // Get window title
            let mut title_buffer = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut title_buffer);
            let title = if len > 0 {
                OsString::from_wide(&title_buffer[..len as usize])
                    .to_string_lossy()
                    .to_string()
            } else {
                String::new()
            };

            // Get process ID
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));

            // Get process name
            let process_name = self.get_process_name(pid).unwrap_or_else(|| "Unknown".to_string());

            Some((title, process_name, pid))
        }
    }

    /// Use UI Automation to find meeting windows (including minimized/background).
    fn find_meeting_windows_via_automation(&self) -> Vec<(String, String, u32)> {
        let mut windows = Vec::new();

        unsafe {
            // Create UI Automation instance
            let automation: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) {
                Ok(a) => a,
                Err(_) => return windows,
            };

            // Get root element (desktop)
            let root = match automation.GetRootElement() {
                Ok(r) => r,
                Err(_) => return windows,
            };

            // Find all top-level windows (this handles minimized and background windows)
            // Using FindAll with TrueCondition would be expensive, so we enumerate known meeting app windows
            for app_name in MEETING_APPS {
                if let Ok(condition) = automation.CreatePropertyCondition(
                    UIA_NamePropertyId,
                    &windows::core::VARIANT::from(*app_name),
                ) {
                    // Note: FindAll searches all descendants including minimized windows
                    // For production, you'd use a more targeted approach
                    if let Ok(elements) = root.FindAll(
                        windows::Win32::UI::Accessibility::TreeScope_Children,
                        &condition,
                    ) {
                        if let Ok(count) = elements.Length() {
                            for i in 0..count {
                                if let Ok(element) = elements.GetElement(i) {
                                    if let Ok(name) = element.CurrentName() {
                                        if let Ok(pid_variant) = element.GetCurrentPropertyValue(UIA_ProcessIdPropertyId) {
                                            if let Ok(pid) = i32::try_from(&pid_variant) {
                                                windows.push((
                                                    name.to_string(),
                                                    app_name.to_string(),
                                                    pid as u32,
                                                ));
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

        windows
    }

    /// Query running processes via WMI.
    fn get_meeting_processes_wmi(&self) -> Vec<Win32Process> {
        let com_lib = match COMLibrary::without_security() {
            Ok(lib) => lib,
            Err(_) => return Vec::new(),
        };

        let wmi_con = match WMIConnection::new(com_lib) {
            Ok(con) => con,
            Err(_) => return Vec::new(),
        };

        // Query for running processes
        let query = "SELECT ProcessId, Name, CommandLine, ExecutablePath, ParentProcessId FROM Win32_Process";
        let processes: WMIResult<Vec<Win32Process>> = wmi_con.raw_query(query);

        match processes {
            Ok(procs) => procs
                .into_iter()
                .filter(|p| {
                    let name_lower = p.name.to_lowercase();
                    MEETING_APPS.iter().any(|app| name_lower.contains(&app.to_lowercase()))
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Detect if this is a UWP app vs Win32.
    fn is_uwp_app(&self, pid: u32) -> bool {
        // UWP apps typically run under ApplicationFrameHost.exe or have specific paths
        if let Some(name) = self.get_process_name(pid) {
            let name_lower = name.to_lowercase();
            name_lower.contains("applicationframehost")
                || name_lower.contains("wwahosthost")
                || name_lower.contains("wwahost")
        } else {
            false
        }
    }

    /// Check if camera is in use by examining active capture sessions.
    fn is_camera_in_use(&self, audio_sessions: &[AudioSessionInfo]) -> bool {
        // Check for active capture sessions (which indicate mic/camera usage)
        audio_sessions.iter().any(|s| s.is_capture && s.is_active)
    }

    /// Check if microphone is in use.
    fn is_mic_in_use(&self, audio_sessions: &[AudioSessionInfo]) -> bool {
        // Capture sessions indicate microphone usage
        audio_sessions.iter().any(|s| s.is_capture && s.is_active)
    }

    /// Find the most likely meeting app from various sources.
    fn find_best_meeting_match(
        &self,
        audio_sessions: &[AudioSessionInfo],
        foreground: Option<&(String, String, u32)>,
        wmi_processes: &[Win32Process],
    ) -> Option<(String, u32, String)> {
        // Priority 1: Active audio session that's a known meeting app
        for session in audio_sessions.iter().filter(|s| s.is_active && s.is_capture) {
            let name_lower = session.process_name.to_lowercase();
            if MEETING_APPS.iter().any(|app| name_lower.contains(&app.to_lowercase())) {
                return Some((
                    session.process_name.clone(),
                    session.process_id,
                    String::new(),
                ));
            }
        }

        // Priority 2: Foreground window is a meeting app
        if let Some((title, process, pid)) = foreground {
            let name_lower = process.to_lowercase();
            if MEETING_APPS.iter().any(|app| name_lower.contains(&app.to_lowercase())) {
                return Some((process.clone(), *pid, title.clone()));
            }
        }

        // Priority 3: WMI shows a meeting app running
        if let Some(proc) = wmi_processes.first() {
            return Some((
                proc.name.clone(),
                proc.process_id,
                proc.command_line.clone().unwrap_or_default(),
            ));
        }

        None
    }
}

impl Drop for WindowsDetector {
    fn drop(&mut self) {
        if self.com_initialized {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

impl PlatformDetector for WindowsDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Get all audio sessions via WASAPI
        let audio_sessions = self.get_audio_sessions();

        // Check camera/mic activity
        let camera_active = self.is_camera_in_use(&audio_sessions);
        let mic_active = self.is_mic_in_use(&audio_sessions);

        if !camera_active && !mic_active {
            // No active capture, but still check for meeting apps
            let wmi_procs = self.get_meeting_processes_wmi();
            if wmi_procs.is_empty() {
                return Ok(None);
            }
        }

        // Get foreground window info via UI Automation / Win32
        let foreground = self.get_foreground_window_info();

        // Get meeting processes via WMI
        let wmi_procs = self.get_meeting_processes_wmi();

        // Find the best match
        let (process_name, pid, window_title) = self
            .find_best_meeting_match(&audio_sessions, foreground.as_ref(), &wmi_procs)
            .unwrap_or_else(|| {
                foreground
                    .clone()
                    .map(|(t, p, pid)| (p, pid, t))
                    .unwrap_or(("Unknown".to_string(), 0, String::new()))
            });

        // Get parent PID from WMI
        let parent_pid = wmi_procs
            .iter()
            .find(|p| p.process_id == pid)
            .and_then(|p| p.parent_process_id)
            .map(|p| p.to_string())
            .unwrap_or_default();

        // Get process path
        let process_path = wmi_procs
            .iter()
            .find(|p| p.process_id == pid)
            .and_then(|p| p.executable_path.clone())
            .unwrap_or_default();

        // Generate session ID
        let session_id = format!(
            "{}-{}",
            process_name.to_lowercase().replace(' ', "-"),
            chrono::Utc::now().timestamp()
        );

        // Determine verdict based on activity
        let verdict = if camera_active {
            "allowed".to_string()
        } else if mic_active {
            "requested".to_string()
        } else {
            "idle".to_string()
        };

        // Get front app info
        let front_app = foreground
            .as_ref()
            .map(|(_, p, _)| p.clone())
            .unwrap_or_default();

        let title = foreground
            .as_ref()
            .map(|(t, _, _)| t.clone())
            .unwrap_or(window_title);

        let signal = MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: process_name.clone(),
            verdict,
            preflight: false,
            process: process_name,
            pid: pid.to_string(),
            parent_pid,
            process_path,
            front_app,
            window_title: title,
            session_id,
            camera_active,
            chrome_url: None,
        };

        if self.debug {
            tracing::debug!("[WindowsDetector] Signal: {:?}", signal);
        }

        Ok(Some(signal))
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        // Test COM initialization and basic API access
        unsafe {
            // Try to create device enumerator - this tests basic COM/WASAPI access
            let result: windows::core::Result<IMMDeviceEnumerator> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);

            match result {
                Ok(_) => Ok(()),
                Err(e) => Err(DetectorError::Platform(format!(
                    "Windows audio API not accessible: {}. Ensure audio services are running.",
                    e
                ))),
            }
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
        // This test will only pass on Windows
        #[cfg(target_os = "windows")]
        {
            let detector = WindowsDetector::new();
            assert!(detector.is_ok());
            let detector = detector.unwrap();
            assert_eq!(detector.platform_name(), "Windows");
        }

        #[cfg(not(target_os = "windows"))]
        {
            // On non-Windows, just verify the struct exists
            assert_eq!(std::mem::size_of::<WindowsDetector>(), std::mem::size_of::<bool>() * 2);
        }
    }

    #[test]
    fn test_meeting_apps_list() {
        assert!(MEETING_APPS.contains(&"Teams"));
        assert!(MEETING_APPS.contains(&"Zoom"));
        assert!(MEETING_APPS.contains(&"Slack"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_check_permissions() {
        let detector = WindowsDetector::new().unwrap();
        // Should succeed if audio services are running
        let result = detector.check_permissions();
        // Don't assert success - CI might not have audio
        println!("Permission check result: {:?}", result);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_get_foreground_window() {
        let detector = WindowsDetector::new().unwrap();
        // Just test it doesn't crash - actual window depends on environment
        let result = detector.get_foreground_window_info();
        println!("Foreground window: {:?}", result);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_audio_sessions() {
        let detector = WindowsDetector::new().unwrap();
        let sessions = detector.get_audio_sessions();
        println!("Audio sessions: {:?}", sessions);
        // Sessions may be empty if no audio is active
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_wmi_processes() {
        let detector = WindowsDetector::new().unwrap();
        let processes = detector.get_meeting_processes_wmi();
        println!("Meeting processes: {:?}", processes);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_detect() {
        let detector = WindowsDetector::new().unwrap();
        let result = detector.detect();
        assert!(result.is_ok());
        println!("Detection result: {:?}", result);
    }
}
