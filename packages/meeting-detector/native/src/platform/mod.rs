//! Platform-specific detection implementations.
//!
//! Each platform provides a `PlatformDetector` implementation that knows how to
//! detect meeting activity on that OS.

use crate::error::{DetectorError, DetectorResult};
use crate::types::MeetingSignal;
use std::time::Duration;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::MacOSDetector;
#[cfg(target_os = "windows")]
pub use windows::WindowsDetector;
#[cfg(target_os = "linux")]
pub use linux::LinuxDetector;

/// Trait for platform-specific meeting detection.
///
/// Implementors provide the low-level OS hooks to detect when meetings are active.
pub trait PlatformDetector: Send + Sync {
    /// Perform a single detection cycle.
    ///
    /// Returns `Some(signal)` if meeting activity is detected, `None` otherwise.
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>>;

    /// Get the recommended polling interval for this platform.
    fn poll_interval(&self) -> Duration;

    /// Check if the detector has the required permissions.
    fn check_permissions(&self) -> DetectorResult<()>;

    /// Get the name of this platform.
    fn platform_name(&self) -> &'static str;

    /// Probe for any currently active meeting (startup check).
    fn probe_active_meeting(&self) -> DetectorResult<Option<MeetingSignal>> {
        self.detect()
    }
}

/// Create the appropriate platform detector for the current OS.
pub fn create_platform_detector() -> DetectorResult<Box<dyn PlatformDetector>> {
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(MacOSDetector::new()?))
    }

    #[cfg(target_os = "windows")]
    {
        Ok(Box::new(WindowsDetector::new()?))
    }

    #[cfg(target_os = "linux")]
    {
        Ok(Box::new(LinuxDetector::new()?))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(crate::error::DetectorError::PlatformNotSupported)
    }
}

/// Stub detector for unsupported platforms or testing.
#[derive(Debug, Default)]
pub struct StubDetector;

impl PlatformDetector for StubDetector {
    fn detect(&self) -> DetectorResult<Option<MeetingSignal>> {
        Ok(None)
    }

    fn poll_interval(&self) -> Duration {
        Duration::from_secs(1)
    }

    fn check_permissions(&self) -> DetectorResult<()> {
        Ok(())
    }

    fn platform_name(&self) -> &'static str {
        "stub"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_detector() {
        let detector = StubDetector::default();
        assert_eq!(detector.platform_name(), "stub");
        assert!(detector.detect().unwrap().is_none());
        assert!(detector.check_permissions().is_ok());
    }
}
