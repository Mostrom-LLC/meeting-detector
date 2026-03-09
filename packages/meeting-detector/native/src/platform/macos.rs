//! macOS platform detection using native APIs.
//!
//! Detection methods:
//! - NSWorkspace for front application detection
//! - Accessibility API (AXUIElement) for window enumeration (all windows)
//! - CoreAudio (AudioObjectGetPropertyData) for audio device state
//! - Process checks for camera daemon (VDCAssistant/AppleCameraAssistant)

use crate::error::{DetectorError, DetectorResult};
use crate::platform::PlatformDetector;
use crate::types::MeetingSignal;
use std::ffi::{c_void, CStr};
use std::ptr;
use std::time::Duration;

use core_foundation::base::{CFRelease, CFTypeRef, TCFType, kCFAllocatorDefault};
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::dictionary::CFDictionaryRef;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send, msg_send_id, ClassType};
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
use objc2_foundation::{NSArray, NSString, NSProcessInfo};

// CoreAudio bindings
#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        ioDataSize: *mut u32,
        outData: *mut c_void,
    ) -> i32;
}

#[repr(C)]
struct AudioObjectPropertyAddress {
    mSelector: u32,
    mScope: u32,
    mElement: u32,
}

// CoreAudio constants
const kAudioHardwarePropertyDevices: u32 = 0x64657623; // 'dev#'
const kAudioObjectPropertyScopeGlobal: u32 = 0x676c6f62; // 'glob'
const kAudioObjectPropertyElementMain: u32 = 0;
const kAudioDevicePropertyDeviceIsRunningSomewhere: u32 = 0x676f6e65; // 'gone' - actually 'rnng'
const kAudioObjectSystemObject: u32 = 1;
const kAudioDevicePropertyStreamConfiguration: u32 = 0x73636667; // 'scfg'
const kAudioObjectPropertyScopeInput: u32 = 0x696e7074; // 'inpt'

// Accessibility bindings
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementCopyAttributeValues(
        element: AXUIElementRef,
        attribute: CFStringRef,
        index: i64,
        maxValues: i64,
        values: *mut CFArrayRef,
    ) -> i32;
    fn AXIsProcessTrusted() -> bool;
}

type AXUIElementRef = *const c_void;

// Known meeting application identifiers
const MEETING_APPS: &[&str] = &[
    "us.zoom.xos",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.apple.FaceTime",
    "com.cisco.webexmeetingsapp",
    "com.webex.meetingmanager",
    "com.slack.Slack",
    "com.hnc.Discord",
    "com.skype.skype",
    "com.google.Chrome",
    "com.apple.Safari",
    "org.mozilla.firefox",
    "com.microsoft.edgemac",
    "com.brave.Browser",
];

/// Window information from Accessibility API
#[derive(Debug, Clone)]
struct WindowInfo {
    title: String,
    app_name: String,
    pid: i32,
    is_minimized: bool,
}

/// macOS meeting detector using native APIs.
#[derive(Debug)]
pub struct MacOSDetector {
    debug: bool,
}

impl MacOSDetector {
    /// Create a new macOS detector with native API access.
    pub fn new() -> DetectorResult<Self> {
        Ok(Self { debug: false })
    }

    /// Enable debug logging.
    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Get the frontmost application using NSWorkspace.
    fn get_front_app(&self) -> Option<(String, String, i32)> {
        unsafe {
            let workspace = NSWorkspace::sharedWorkspace();
            let front_app = workspace.frontmostApplication()?;
            
            let name = front_app.localizedName()?;
            let name_str = name.to_string();
            
            let bundle_id = front_app.bundleIdentifier()
                .map(|s| s.to_string())
                .unwrap_or_default();
            
            let pid = front_app.processIdentifier();
            
            Some((name_str, bundle_id, pid))
        }
    }

    /// Get all running applications using NSWorkspace.
    fn get_running_apps(&self) -> Vec<(String, String, i32)> {
        unsafe {
            let workspace = NSWorkspace::sharedWorkspace();
            let apps = workspace.runningApplications();
            
            let mut result = Vec::new();
            for i in 0..apps.count() {
                if let Some(app) = apps.objectAtIndex(i) {
                    let app: &NSRunningApplication = &*app;
                    if let Some(name) = app.localizedName() {
                        let name_str = name.to_string();
                        let bundle_id = app.bundleIdentifier()
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        let pid = app.processIdentifier();
                        result.push((name_str, bundle_id, pid));
                    }
                }
            }
            result
        }
    }

    /// Get all windows using Accessibility API (handles minimized/background windows).
    fn get_all_windows(&self) -> Vec<WindowInfo> {
        let mut windows = Vec::new();
        
        unsafe {
            // Check if we have accessibility permissions
            if !AXIsProcessTrusted() {
                if self.debug {
                    tracing::warn!("Accessibility permission not granted");
                }
                return windows;
            }

            let system_wide = AXUIElementCreateSystemWide();
            if system_wide.is_null() {
                return windows;
            }

            // Get all applications
            let apps_attr = CFString::new("AXApplication");
            let mut apps_value: CFTypeRef = ptr::null();
            
            // Instead of system-wide, iterate through running apps
            let running_apps = self.get_running_apps();
            
            for (app_name, _bundle_id, pid) in running_apps {
                // Create AXUIElement for this application
                let app_element = AXUIElementCreateApplication(pid);
                if app_element.is_null() {
                    continue;
                }

                // Get windows for this application
                let windows_attr = CFString::new("AXWindows");
                let mut windows_array: CFArrayRef = ptr::null();
                
                let result = AXUIElementCopyAttributeValues(
                    app_element,
                    windows_attr.as_concrete_TypeRef(),
                    0,
                    100, // max windows
                    &mut windows_array,
                );

                if result == 0 && !windows_array.is_null() {
                    let count = CFArrayGetCount(windows_array);
                    for i in 0..count {
                        let window = CFArrayGetValueAtIndex(windows_array, i);
                        if !window.is_null() {
                            // Get window title
                            let title_attr = CFString::new("AXTitle");
                            let mut title_value: CFTypeRef = ptr::null();
                            
                            if AXUIElementCopyAttributeValue(
                                window as AXUIElementRef,
                                title_attr.as_concrete_TypeRef(),
                                &mut title_value,
                            ) == 0 && !title_value.is_null() {
                                let title_cf = title_value as CFStringRef;
                                let title = cfstring_to_string(title_cf);
                                CFRelease(title_value);

                                // Check if minimized
                                let minimized_attr = CFString::new("AXMinimized");
                                let mut minimized_value: CFTypeRef = ptr::null();
                                let is_minimized = if AXUIElementCopyAttributeValue(
                                    window as AXUIElementRef,
                                    minimized_attr.as_concrete_TypeRef(),
                                    &mut minimized_value,
                                ) == 0 && !minimized_value.is_null() {
                                    let result = CFBooleanGetValue(minimized_value as _);
                                    CFRelease(minimized_value);
                                    result
                                } else {
                                    false
                                };

                                windows.push(WindowInfo {
                                    title,
                                    app_name: app_name.clone(),
                                    pid,
                                    is_minimized,
                                });
                            }
                        }
                    }
                    CFRelease(windows_array as CFTypeRef);
                }
                CFRelease(app_element as CFTypeRef);
            }
            CFRelease(system_wide as CFTypeRef);
        }

        windows
    }

    /// Check if any audio input device is active using CoreAudio.
    fn is_audio_input_active(&self) -> bool {
        unsafe {
            // Get list of audio devices
            let address = AudioObjectPropertyAddress {
                mSelector: kAudioHardwarePropertyDevices,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain,
            };

            let mut data_size: u32 = 0;
            let result = AudioObjectGetPropertyData(
                kAudioObjectSystemObject,
                &address,
                0,
                ptr::null(),
                &mut data_size,
                ptr::null_mut(),
            );

            if result != 0 || data_size == 0 {
                return false;
            }

            let device_count = data_size as usize / std::mem::size_of::<u32>();
            let mut devices: Vec<u32> = vec![0; device_count];
            
            let result = AudioObjectGetPropertyData(
                kAudioObjectSystemObject,
                &address,
                0,
                ptr::null(),
                &mut data_size,
                devices.as_mut_ptr() as *mut c_void,
            );

            if result != 0 {
                return false;
            }

            // Check each device for input streams and activity
            for device_id in devices {
                // Check if device has input streams
                let input_address = AudioObjectPropertyAddress {
                    mSelector: kAudioDevicePropertyStreamConfiguration,
                    mScope: kAudioObjectPropertyScopeInput,
                    mElement: kAudioObjectPropertyElementMain,
                };

                let mut stream_size: u32 = 0;
                let result = AudioObjectGetPropertyData(
                    device_id,
                    &input_address,
                    0,
                    ptr::null(),
                    &mut stream_size,
                    ptr::null_mut(),
                );

                if result == 0 && stream_size > 8 {
                    // Device has input capability, check if running
                    let running_address = AudioObjectPropertyAddress {
                        mSelector: 0x72756e67, // 'rung' - device is running
                        mScope: kAudioObjectPropertyScopeGlobal,
                        mElement: kAudioObjectPropertyElementMain,
                    };

                    let mut is_running: u32 = 0;
                    let mut running_size: u32 = std::mem::size_of::<u32>() as u32;
                    
                    let result = AudioObjectGetPropertyData(
                        device_id,
                        &running_address,
                        0,
                        ptr::null(),
                        &mut running_size,
                        &mut is_running as *mut u32 as *mut c_void,
                    );

                    if result == 0 && is_running != 0 {
                        if self.debug {
                            tracing::debug!("Audio input device {} is active", device_id);
                        }
                        return true;
                    }
                }
            }

            false
        }
    }

    /// Check if camera is in use by looking for camera daemon processes.
    /// On macOS, VDCAssistant or AppleCameraAssistant run when camera is active.
    fn is_camera_active(&self) -> bool {
        let apps = self.get_running_apps();
        
        for (name, bundle_id, _pid) in apps {
            let name_lower = name.to_lowercase();
            if name_lower.contains("vdcassistant") 
                || name_lower.contains("applecameraassistant")
                || bundle_id.contains("camera") 
            {
                return true;
            }
        }

        // Also check via sysctl for camera state (more reliable on newer macOS)
        // This is a simplified check - full implementation would use IOKit
        false
    }

    /// Find meeting apps among running applications.
    fn find_meeting_app(&self) -> Option<(String, String, i32)> {
        let apps = self.get_running_apps();
        
        for (name, bundle_id, pid) in apps {
            let id_lower = bundle_id.to_lowercase();
            for meeting_id in MEETING_APPS {
                if id_lower.contains(&meeting_id.to_lowercase()) {
                    return Some((name, bundle_id, pid));
                }
            }
        }
        
        None
    }

    /// Get window title for a specific app by PID.
    fn get_window_title_for_pid(&self, target_pid: i32) -> Option<String> {
        let windows = self.get_all_windows();
        
        for window in windows {
            if window.pid == target_pid && !window.title.is_empty() {
                return Some(window.title);
            }
        }
        
        None
    }
}

// Additional Accessibility bindings
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn CFArrayGetCount(array: CFArrayRef) -> i64;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: i64) -> *const c_void;
    fn CFBooleanGetValue(boolean: CFTypeRef) -> bool;
}

/// Convert CFString to Rust String
unsafe fn cfstring_to_string(cf_string: CFStringRef) -> String {
    if cf_string.is_null() {
        return String::new();
    }
    
    let cf = CFString::wrap_under_get_rule(cf_string);
    cf.to_string()
}

impl PlatformDetector for MacOSDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        // Check for camera/mic activity using native APIs
        let camera_active = self.is_camera_active();
        let mic_active = self.is_audio_input_active();

        if !camera_active && !mic_active {
            // Check if any meeting app is running even without active A/V
            if self.find_meeting_app().is_none() {
                return Ok(None);
            }
        }

        // Get front app using NSWorkspace
        let (front_app_name, front_app_bundle, front_app_pid) = self
            .get_front_app()
            .unwrap_or(("Unknown".to_string(), String::new(), 0));

        // Try to find an active meeting app
        let (process_name, bundle_id, pid) = self
            .find_meeting_app()
            .unwrap_or((front_app_name.clone(), front_app_bundle, front_app_pid));

        // Get window title using Accessibility API
        let window_title = self
            .get_window_title_for_pid(pid)
            .unwrap_or_default();

        // Generate session ID
        let session_id = format!(
            "{}-{}",
            process_name.to_lowercase().replace(' ', "-"),
            chrono::Utc::now().timestamp()
        );

        // Determine verdict
        let verdict = if camera_active {
            "allowed".to_string()
        } else if mic_active {
            "requested".to_string()
        } else {
            "idle".to_string()
        };

        let signal = MeetingSignal {
            event: "meeting_signal".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            service: process_name.clone(),
            verdict,
            preflight: false,
            process: process_name,
            pid: pid.to_string(),
            parent_pid: String::new(),
            process_path: String::new(), // Could get from NSRunningApplication.executableURL
            front_app: front_app_name,
            window_title,
            session_id,
            camera_active,
            chrome_url: None,
        };

        if self.debug {
            tracing::debug!("[MacOSDetector] Signal: {:?}", signal);
        }

        Ok(Some(signal))
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_millis(500)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        unsafe {
            if !AXIsProcessTrusted() {
                return Err(DetectorError::PermissionDenied(
                    "Accessibility permission required. Enable in System Preferences > Security & Privacy > Privacy > Accessibility".to_string()
                ));
            }
        }
        Ok(())
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
        let detector = MacOSDetector::new();
        assert!(detector.is_ok());
        let detector = detector.unwrap();
        assert_eq!(detector.platform_name(), "macOS");
    }

    #[test]
    fn test_meeting_apps_list() {
        assert!(MEETING_APPS.contains(&"us.zoom.xos"));
        assert!(MEETING_APPS.contains(&"com.microsoft.teams"));
        assert!(MEETING_APPS.contains(&"com.apple.FaceTime"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_front_app() {
        let detector = MacOSDetector::new().unwrap();
        // Just verify it doesn't crash
        let result = detector.get_front_app();
        println!("Front app: {:?}", result);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_running_apps() {
        let detector = MacOSDetector::new().unwrap();
        let apps = detector.get_running_apps();
        // Should have at least some running apps
        assert!(!apps.is_empty(), "Should have running apps");
        println!("Running apps count: {}", apps.len());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_check_permissions() {
        let detector = MacOSDetector::new().unwrap();
        let result = detector.check_permissions();
        // May fail if accessibility not granted
        println!("Permission check: {:?}", result);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_detect() {
        let detector = MacOSDetector::new().unwrap();
        let result = detector.detect();
        assert!(result.is_ok());
        println!("Detection result: {:?}", result);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_audio_input() {
        let detector = MacOSDetector::new().unwrap();
        let active = detector.is_audio_input_active();
        println!("Audio input active: {}", active);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_all_windows() {
        let detector = MacOSDetector::new().unwrap();
        let windows = detector.get_all_windows();
        println!("Windows found: {}", windows.len());
        for w in &windows {
            println!("  - {} ({}): {}", w.app_name, w.pid, w.title);
        }
    }
}
