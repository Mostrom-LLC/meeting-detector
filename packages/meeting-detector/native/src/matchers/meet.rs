//! Google Meet platform matcher.

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;
use std::sync::LazyLock;
use regex::Regex;

// Google Meet URL pattern: xxx-xxxx-xxx
static MEET_CODE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[a-z]{3}-[a-z]{4}-[a-z]{3}").unwrap()
});

/// Matcher for Google Meet meetings.
#[derive(Debug, Default)]
pub struct GoogleMeetMatcher;

impl PlatformMatcher for GoogleMeetMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let title = ctx.window_title.to_lowercase();

        // Browser-based Meet (most common)
        if let Some(ref url) = ctx.url {
            if url.contains("meet.google.com") {
                // Verify it's an actual meeting, not the landing page
                if MEET_CODE_REGEX.is_match(url) || ctx.camera_active {
                    return Some(MeetingPlatform::GoogleMeet);
                }
            }
        }

        // Window title patterns
        if title.contains("meet.google.com") {
            return Some(MeetingPlatform::GoogleMeet);
        }

        // Title contains "Meet - " prefix (Google Meet format)
        if title.starts_with("meet - ") || title.starts_with("meet –") {
            return Some(MeetingPlatform::GoogleMeet);
        }

        // Title contains meet code pattern
        if MEET_CODE_REGEX.is_match(&title) {
            // Additional check: camera should be active to avoid false positives
            // from calendar previews showing meet codes
            if ctx.camera_active {
                return Some(MeetingPlatform::GoogleMeet);
            }
        }

        None
    }

    fn priority(&self) -> u32 {
        90  // Slightly lower than Zoom/Teams to avoid Chrome conflicts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meet_url() {
        let matcher = GoogleMeetMatcher;
        
        let ctx = MatchContext::new("Google Chrome", "abc-defg-hij - Google Meet")
            .with_url("https://meet.google.com/abc-defg-hij");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::GoogleMeet));
    }

    #[test]
    fn test_meet_landing_page() {
        let matcher = GoogleMeetMatcher;
        
        // Landing page without meeting code should not match
        let ctx = MatchContext::new("Google Chrome", "Google Meet")
            .with_url("https://meet.google.com/");
        assert_eq!(matcher.matches(&ctx), None);
    }

    #[test]
    fn test_meet_title_pattern() {
        let matcher = GoogleMeetMatcher;
        
        let ctx = MatchContext::new("Google Chrome", "Meet - Team Sync")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::GoogleMeet));
    }

    #[test]
    fn test_meet_code_regex() {
        assert!(MEET_CODE_REGEX.is_match("abc-defg-hij"));
        assert!(!MEET_CODE_REGEX.is_match("abc-def-ghij")); // Wrong pattern
    }
}
