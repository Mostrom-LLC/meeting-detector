//! Platform matchers for identifying meeting applications.
//!
//! Matchers analyze process names, window titles, and URLs to identify
//! which meeting platform is active.

use crate::types::MeetingPlatform;

mod generic;
mod meet;
mod slack;
mod teams;
mod zoom;

pub use generic::GenericMatcher;
pub use meet::GoogleMeetMatcher;
pub use slack::SlackMatcher;
pub use teams::TeamsMatcher;
pub use zoom::ZoomMatcher;

/// Trait for platform matchers.
pub trait PlatformMatcher: Send + Sync {
    /// Check if this matcher matches the given context.
    ///
    /// Returns the platform if matched, None otherwise.
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform>;

    /// Get the priority of this matcher (higher = checked first).
    fn priority(&self) -> u32 {
        0
    }
}

/// Context for platform matching.
#[derive(Debug, Clone, Default)]
pub struct MatchContext {
    /// Process name (normalized)
    pub process_name: String,
    /// Window title
    pub window_title: String,
    /// URL (for browser-based meetings)
    pub url: Option<String>,
    /// WM_CLASS on Linux, bundle identifier on macOS
    pub app_id: Option<String>,
    /// Whether camera is active
    pub camera_active: bool,
    /// Whether microphone is active
    pub mic_active: bool,
}

impl MatchContext {
    /// Create a new match context.
    pub fn new(process_name: impl Into<String>, window_title: impl Into<String>) -> Self {
        Self {
            process_name: process_name.into(),
            window_title: window_title.into(),
            ..Default::default()
        }
    }

    /// Set the URL.
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    /// Set the app ID.
    pub fn with_app_id(mut self, app_id: impl Into<String>) -> Self {
        self.app_id = Some(app_id.into());
        self
    }

    /// Set camera active state.
    pub fn with_camera_active(mut self, active: bool) -> Self {
        self.camera_active = active;
        self
    }
}

/// Registry of all platform matchers.
pub struct MatcherRegistry {
    matchers: Vec<Box<dyn PlatformMatcher>>,
}

impl Default for MatcherRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl MatcherRegistry {
    /// Create a new registry with all built-in matchers.
    pub fn new() -> Self {
        let mut matchers: Vec<Box<dyn PlatformMatcher>> = vec![
            Box::new(ZoomMatcher),
            Box::new(TeamsMatcher),
            Box::new(GoogleMeetMatcher),
            Box::new(SlackMatcher),
            Box::new(GenericMatcher),
        ];

        // Sort by priority (highest first)
        matchers.sort_by(|a, b| b.priority().cmp(&a.priority()));

        Self { matchers }
    }

    /// Try to match a platform from the given context.
    pub fn match_platform(&self, ctx: &MatchContext) -> MeetingPlatform {
        for matcher in &self.matchers {
            if let Some(platform) = matcher.matches(ctx) {
                return platform;
            }
        }
        MeetingPlatform::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_match_context() {
        let ctx = MatchContext::new("zoom", "Zoom Meeting").with_camera_active(true);

        assert_eq!(ctx.process_name, "zoom");
        assert_eq!(ctx.window_title, "Zoom Meeting");
        assert!(ctx.camera_active);
    }

    #[test]
    fn test_registry_creation() {
        let registry = MatcherRegistry::new();
        assert!(!registry.matchers.is_empty());
    }
}
