//! Linux-specific integration tests
//!
//! These tests verify the Linux platform implementation.
//! Run with: cargo test --test linux_integration

#![cfg(target_os = "linux")]

use meeting_detector_native::platform::{LinuxDetector, PlatformDetector};

#[test]
fn test_detector_initialization() {
    let detector = LinuxDetector::new();
    assert!(detector.is_ok(), "LinuxDetector should initialize successfully");
    
    let detector = detector.unwrap();
    assert_eq!(detector.platform_name(), "Linux");
}

#[test]
fn test_poll_interval() {
    let detector = LinuxDetector::new().expect("Failed to create detector");
    let interval = detector.poll_interval();
    
    // Should be 500ms as specified
    assert_eq!(interval.as_millis(), 500);
}

#[test]
fn test_permission_check() {
    let detector = LinuxDetector::new().expect("Failed to create detector");
    
    // Permission check - should succeed even without X11
    let result = detector.check_permissions();
    assert!(result.is_ok());
}

#[test]
fn test_detect_no_panic() {
    let detector = LinuxDetector::new().expect("Failed to create detector");
    
    // Detection should not panic even without active meetings
    let result = detector.detect();
    assert!(result.is_ok(), "detect() should not return error");
    
    match result.unwrap() {
        Some(signal) => {
            println!("Meeting detected: {:?}", signal);
            assert!(!signal.event.is_empty());
        }
        None => {
            println!("No meeting detected (expected when no meetings running)");
        }
    }
}

#[test]
fn test_debug_mode() {
    let detector = LinuxDetector::new()
        .expect("Failed to create detector")
        .with_debug(true);
    
    // Should work the same with debug enabled
    let result = detector.detect();
    assert!(result.is_ok());
}

#[test]
fn test_multiple_detections() {
    let detector = LinuxDetector::new().expect("Failed to create detector");
    
    // Multiple detect calls should work
    for i in 0..3 {
        let result = detector.detect();
        assert!(result.is_ok(), "Detection {} failed", i);
    }
}

/// Test process name retrieval via procfs
#[test]
fn test_procfs_process_name() {
    use std::fs;
    
    // Current process PID
    let pid = std::process::id();
    let comm_path = format!("/proc/{}/comm", pid);
    
    let name = fs::read_to_string(&comm_path);
    assert!(name.is_ok(), "Should be able to read /proc/<pid>/comm");
    println!("Current process name: {}", name.unwrap().trim());
}

/// Test /proc filesystem access
#[test]
fn test_proc_filesystem() {
    use std::fs;
    use std::path::Path;
    
    assert!(Path::new("/proc").exists(), "/proc should exist on Linux");
    
    let entries = fs::read_dir("/proc");
    assert!(entries.is_ok(), "Should be able to read /proc directory");
}

/// Test /dev/snd access for audio detection
#[test]
fn test_dev_snd_exists() {
    use std::path::Path;
    
    // /dev/snd should exist on most Linux systems with audio
    if Path::new("/dev/snd").exists() {
        println!("/dev/snd exists - ALSA available");
    } else {
        println!("/dev/snd not found (may be using PipeWire directly)");
    }
}

/// Test X11 display detection
#[test]
fn test_x11_display() {
    let display = std::env::var("DISPLAY");
    match display {
        Ok(d) => println!("X11 DISPLAY: {}", d),
        Err(_) => println!("No X11 DISPLAY (running under Wayland or headless)"),
    }
}
