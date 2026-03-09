//! Windows-specific integration tests
//!
//! These tests verify the Windows platform implementation using native APIs.
//! Run with: cargo test --test windows_integration

#![cfg(target_os = "windows")]

use meeting_detector_native::platform::{WindowsDetector, PlatformDetector};

#[test]
fn test_detector_initialization() {
    let detector = WindowsDetector::new();
    assert!(detector.is_ok(), "WindowsDetector should initialize successfully");
    
    let detector = detector.unwrap();
    assert_eq!(detector.platform_name(), "Windows");
}

#[test]
fn test_com_initialization() {
    // Creating multiple detectors should work (COM should handle re-init)
    let detector1 = WindowsDetector::new();
    let detector2 = WindowsDetector::new();
    
    assert!(detector1.is_ok());
    assert!(detector2.is_ok());
}

#[test]
fn test_permission_check() {
    let detector = WindowsDetector::new().expect("Failed to create detector");
    
    // Permission check tests COM and WASAPI access
    let result = detector.check_permissions();
    
    // This may fail on CI if audio services aren't available
    // Just verify it doesn't panic
    match result {
        Ok(()) => println!("Permissions OK - audio services available"),
        Err(e) => println!("Permission check returned error (may be expected on CI): {:?}", e),
    }
}

#[test]
fn test_poll_interval() {
    let detector = WindowsDetector::new().expect("Failed to create detector");
    let interval = detector.poll_interval();
    
    // Should be 500ms as specified
    assert_eq!(interval.as_millis(), 500);
}

#[test]
fn test_detect_no_panic() {
    let detector = WindowsDetector::new().expect("Failed to create detector");
    
    // Detection should not panic even without active meetings
    let result = detector.detect();
    assert!(result.is_ok(), "detect() should not return error");
    
    // Result may be None if no meetings detected
    match result.unwrap() {
        Some(signal) => {
            println!("Meeting detected: {:?}", signal);
            assert!(!signal.event.is_empty());
            assert!(!signal.timestamp.is_empty());
        }
        None => {
            println!("No meeting detected (expected when no meetings running)");
        }
    }
}

#[test]
fn test_debug_mode() {
    let detector = WindowsDetector::new()
        .expect("Failed to create detector")
        .with_debug(true);
    
    // Should work the same with debug enabled
    let result = detector.detect();
    assert!(result.is_ok());
}

#[test]
fn test_multiple_detections() {
    let detector = WindowsDetector::new().expect("Failed to create detector");
    
    // Multiple detect calls should work
    for i in 0..3 {
        let result = detector.detect();
        assert!(result.is_ok(), "Detection {} failed", i);
    }
}

/// Test that WASAPI enumeration works
#[test]
fn test_wasapi_access() {
    use windows::Win32::Media::Audio::{
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        // Create device enumerator
        let result: windows::core::Result<IMMDeviceEnumerator> =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
        
        // Should succeed if audio service is running
        match result {
            Ok(_) => println!("WASAPI device enumerator created successfully"),
            Err(e) => println!("WASAPI not available (may be expected on CI): {:?}", e),
        }
    }
}

/// Test WMI process enumeration
#[test]
fn test_wmi_access() {
    use wmi::{COMLibrary, WMIConnection};
    
    let com_lib = COMLibrary::without_security();
    assert!(com_lib.is_ok(), "COM library should initialize");
    
    let wmi_con = WMIConnection::new(com_lib.unwrap());
    assert!(wmi_con.is_ok(), "WMI connection should succeed");
    
    // Query process count to verify WMI works
    let wmi = wmi_con.unwrap();
    let result: Result<Vec<std::collections::HashMap<String, wmi::Variant>>, _> = 
        wmi.raw_query("SELECT ProcessId FROM Win32_Process WHERE ProcessId = 4");
    
    match result {
        Ok(processes) => {
            println!("WMI query returned {} results", processes.len());
            assert!(!processes.is_empty(), "Should find System process (PID 4)");
        }
        Err(e) => {
            panic!("WMI query failed: {:?}", e);
        }
    }
}

/// Test UI Automation access
#[test]
fn test_ui_automation_access() {
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        
        let result: windows::core::Result<IUIAutomation> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL);
        
        match result {
            Ok(automation) => {
                println!("UI Automation created successfully");
                
                // Try to get root element
                let root = automation.GetRootElement();
                assert!(root.is_ok(), "Should be able to get root element");
            }
            Err(e) => {
                panic!("UI Automation creation failed: {:?}", e);
            }
        }
    }
}

/// Test foreground window detection
#[test]
fn test_foreground_window() {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    
    unsafe {
        let hwnd = GetForegroundWindow();
        // There should be a foreground window in a desktop session
        // On CI this might be null, which is fine
        println!("Foreground window handle: {:?}", hwnd.0);
    }
}
