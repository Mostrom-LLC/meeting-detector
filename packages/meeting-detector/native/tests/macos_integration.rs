//! macOS-specific integration tests
//!
//! These tests verify the macOS platform implementation using native APIs.
//! Run with: cargo test --test macos_integration

#![cfg(target_os = "macos")]

use meeting_detector_native::platform::{MacOSDetector, PlatformDetector};

#[test]
fn test_detector_initialization() {
    let detector = MacOSDetector::new();
    assert!(detector.is_ok(), "MacOSDetector should initialize successfully");
    
    let detector = detector.unwrap();
    assert_eq!(detector.platform_name(), "macOS");
}

#[test]
fn test_poll_interval() {
    let detector = MacOSDetector::new().expect("Failed to create detector");
    let interval = detector.poll_interval();
    
    // Should be 500ms as specified
    assert_eq!(interval.as_millis(), 500);
}

#[test]
fn test_permission_check() {
    let detector = MacOSDetector::new().expect("Failed to create detector");
    
    // Permission check tests Accessibility API access
    let result = detector.check_permissions();
    
    match result {
        Ok(()) => println!("Accessibility permissions granted"),
        Err(e) => println!("Permission check returned error (may be expected without accessibility): {:?}", e),
    }
}

#[test]
fn test_detect_no_panic() {
    let detector = MacOSDetector::new().expect("Failed to create detector");
    
    // Detection should not panic even without active meetings
    let result = detector.detect();
    assert!(result.is_ok(), "detect() should not return error");
    
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
    let detector = MacOSDetector::new()
        .expect("Failed to create detector")
        .with_debug(true);
    
    // Should work the same with debug enabled
    let result = detector.detect();
    assert!(result.is_ok());
}

#[test]
fn test_multiple_detections() {
    let detector = MacOSDetector::new().expect("Failed to create detector");
    
    // Multiple detect calls should work
    for i in 0..3 {
        let result = detector.detect();
        assert!(result.is_ok(), "Detection {} failed", i);
    }
}

/// Test NSWorkspace front app detection
#[test]
fn test_nsworkspace_front_app() {
    use objc2_app_kit::NSWorkspace;
    
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let front_app = workspace.frontmostApplication();
        
        // There should be a frontmost app in a desktop session
        assert!(front_app.is_some(), "Should have a frontmost application");
        
        let app = front_app.unwrap();
        let name = app.localizedName();
        assert!(name.is_some(), "Frontmost app should have a name");
        println!("Frontmost app: {}", name.unwrap());
    }
}

/// Test running applications enumeration
#[test]
fn test_running_applications() {
    use objc2_app_kit::NSWorkspace;
    
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        
        // Should have running applications
        assert!(apps.count() > 0, "Should have running applications");
        println!("Running applications count: {}", apps.count());
    }
}

/// Test Accessibility API availability
#[test]
fn test_accessibility_api() {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    
    unsafe {
        let trusted = AXIsProcessTrusted();
        println!("AXIsProcessTrusted: {}", trusted);
        // Don't assert - CI might not have accessibility
    }
}

/// Test CoreAudio device enumeration
#[test]
fn test_coreaudio_devices() {
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        mSelector: u32,
        mScope: u32,
        mElement: u32,
    }

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

    const kAudioHardwarePropertyDevices: u32 = 0x64657623;
    const kAudioObjectPropertyScopeGlobal: u32 = 0x676c6f62;
    const kAudioObjectPropertyElementMain: u32 = 0;
    const kAudioObjectSystemObject: u32 = 1;

    unsafe {
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

        assert_eq!(result, 0, "AudioObjectGetPropertyData should succeed");
        assert!(data_size > 0, "Should have audio devices");
        
        let device_count = data_size as usize / std::mem::size_of::<u32>();
        println!("Audio device count: {}", device_count);
    }
}
