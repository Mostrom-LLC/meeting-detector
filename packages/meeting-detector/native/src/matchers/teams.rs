//! Microsoft Teams platform matcher.

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;

/// Localized meeting-related keywords.
const MEETING_KEYWORDS: &[&str] = &[
    // English
    "meeting", "call", "calling",
    // German
    "besprechung", "anruf",
    // French
    "réunion", "appel",
    // Spanish
    "reunión", "llamada",
    // Portuguese
    "reunião", "chamada",
    // Italian
    "riunione", "chiamata",
    // Japanese
    "会議", "通話",
    // Chinese
    "会议", "通话",
    // Korean
    "회의", "통화",
];

/// Localized chat keywords (to exclude non-meeting states).
const CHAT_KEYWORDS: &[&str] = &[
    "chat", "conversation", "gespräch", "chat", "conversación", "conversa",
];

/// Matcher for Microsoft Teams meetings.
#[derive(Debug, Default)]
pub struct TeamsMatcher;

impl TeamsMatcher {
    /// Check if title contains any meeting-related keywords (localized).
    fn has_meeting_keyword(title: &str) -> bool {
        MEETING_KEYWORDS.iter().any(|kw| title.contains(kw))
    }

    /// Check if title contains chat keywords without meeting context.
    fn is_chat_only(title: &str) -> bool {
        CHAT_KEYWORDS.iter().any(|kw| title.contains(kw)) 
            && !Self::has_meeting_keyword(title)
    }
}

impl PlatformMatcher for TeamsMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let process = ctx.process_name.to_lowercase();
        let title = ctx.window_title.to_lowercase();

        // Native Teams app (classic and new)
        if process.contains("teams") || process.contains("ms-teams") {
            // Filter out non-meeting states (chat without meeting)
            if Self::is_chat_only(&title) {
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
            if url.contains("teams.microsoft.com") 
                || url.contains("teams.live.com")
            {
                // Check if it's actually a meeting (not just Teams web)
                if Self::has_meeting_keyword(&title) || ctx.camera_active {
                    return Some(MeetingPlatform::MicrosoftTeams);
                }
            }
        }

        // Window title patterns
        if title.contains("microsoft teams") && Self::has_meeting_keyword(&title) {
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

    #[test]
    fn test_teams_localized_german() {
        let matcher = TeamsMatcher;
        
        // German "Besprechung" = meeting
        let ctx = MatchContext::new("Microsoft Teams", "Besprechung mit Team | Microsoft Teams")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }

    #[test]
    fn test_teams_localized_french() {
        let matcher = TeamsMatcher;
        
        // French "réunion" = meeting
        let ctx = MatchContext::new("Microsoft Teams", "Réunion d'équipe | Microsoft Teams")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }

    #[test]
    fn test_teams_localized_spanish() {
        let matcher = TeamsMatcher;
        
        // Spanish "reunión" = meeting
        let ctx = MatchContext::new("Microsoft Teams", "Reunión de proyecto | Microsoft Teams")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }

    #[test]
    fn test_teams_localized_japanese() {
        let matcher = TeamsMatcher;
        
        // Japanese "会議" = meeting
        let ctx = MatchContext::new("Microsoft Teams", "チーム会議 | Microsoft Teams")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }

    #[test]
    fn test_teams_call_keyword() {
        let matcher = TeamsMatcher;
        
        let ctx = MatchContext::new("Microsoft Teams", "Call with Sales Team")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }

    #[test]
    fn test_teams_new_app() {
        let matcher = TeamsMatcher;
        
        // New Teams app process name
        let ctx = MatchContext::new("ms-teams", "Meeting")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::MicrosoftTeams));
    }
}
