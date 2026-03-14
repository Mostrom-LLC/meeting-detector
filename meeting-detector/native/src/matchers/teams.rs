//! Microsoft Teams platform matcher.

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;

/// Matcher for Microsoft Teams meetings.
#[derive(Debug, Default)]
pub struct TeamsMatcher;

impl PlatformMatcher for TeamsMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let process = ctx.process_name.to_lowercase();
        let title = ctx.window_title.to_lowercase();

        // Native Teams app (classic and new)
        if process.contains("teams") || process.contains("ms-teams") {
            // Filter out non-meeting states
            // Teams shows "Microsoft Teams" for chat, "Meeting" or call info for meetings
            if title.contains("chat") && !title.contains("meeting") {
                return None;
            }
            // Activity/notification window
            if title == "microsoft teams" && !ctx.camera_active {
                return None;
            }
            return Some(MeetingPlatform::MicrosoftTeams);
        }

        // Browser-based Teams
        if let Some(ref url) = ctx.url {
            if url.contains("teams.microsoft.com") || url.contains("teams.live.com") {
                // Check if it's actually a meeting (not just Teams web)
                if title.contains("meeting") || title.contains("call") || ctx.camera_active {
                    return Some(MeetingPlatform::MicrosoftTeams);
                }
            }
        }

        // Window title patterns
        if title.contains("microsoft teams") && title.contains("meeting") {
            return Some(MeetingPlatform::MicrosoftTeams);
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
    fn test_teams_native_app() {
        let matcher = TeamsMatcher;

        // Active meeting
        let ctx = MatchContext::new("Microsoft Teams", "Team Meeting | Microsoft Teams")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));

        // Chat only (should not match without camera)
        let ctx = MatchContext::new("Microsoft Teams", "Chat with John | Microsoft Teams");
        assert_eq!(matcher.matches(&ctx), None);
    }

    #[test]
    fn test_teams_browser() {
        let matcher = TeamsMatcher;

        let ctx = MatchContext::new("Google Chrome", "Meeting | Microsoft Teams")
            .with_url("https://teams.microsoft.com/v2/");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }
}
