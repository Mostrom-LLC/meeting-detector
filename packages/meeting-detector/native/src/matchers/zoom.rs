//! Zoom platform matcher.

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;

/// Matcher for Zoom meetings.
#[derive(Debug, Default)]
pub struct ZoomMatcher;

impl PlatformMatcher for ZoomMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let process = ctx.process_name.to_lowercase();
        let title = ctx.window_title.to_lowercase();

        // Native Zoom app
        if process.contains("zoom") {
            // Filter out non-meeting states
            if title.contains("home") 
                || title.contains("settings")
                || title.contains("preferences")
                || (title.is_empty() && !ctx.camera_active)
            {
                return None;
            }
            return Some(MeetingPlatform::Zoom);
        }

        // Browser-based Zoom
        if let Some(ref url) = ctx.url {
            if url.contains("zoom.us/j/") || url.contains("zoom.us/wc/") {
                return Some(MeetingPlatform::Zoom);
            }
        }

        // Window title patterns
        if title.contains("zoom meeting") {
            return Some(MeetingPlatform::Zoom);
        }

        None
    }

    fn priority(&self) -> u32 {
        100
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zoom_native_app() {
        let matcher = ZoomMatcher;
        
        // Active meeting
        let ctx = MatchContext::new("zoom.us", "Zoom Meeting")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::Zoom));

        // Home screen (should not match)
        let ctx = MatchContext::new("zoom.us", "Zoom - Home");
        assert_eq!(matcher.matches(&ctx), None);
    }

    #[test]
    fn test_zoom_browser() {
        let matcher = ZoomMatcher;
        
        let ctx = MatchContext::new("Google Chrome", "Join Meeting")
            .with_url("https://zoom.us/j/12345678901");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::Zoom));
    }

    #[test]
    fn test_non_zoom() {
        let matcher = ZoomMatcher;
        
        let ctx = MatchContext::new("Microsoft Teams", "Meeting");
        assert_eq!(matcher.matches(&ctx), None);
    }
}
