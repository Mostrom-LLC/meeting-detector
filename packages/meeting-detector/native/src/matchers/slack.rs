//! Slack platform matcher (huddles and calls).

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;

/// Matcher for Slack huddles and calls.
#[derive(Debug, Default)]
pub struct SlackMatcher;

impl PlatformMatcher for SlackMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let process = ctx.process_name.to_lowercase();
        let title = ctx.window_title.to_lowercase();

        // Native Slack app
        if process.contains("slack") {
            // Slack huddles show distinctive UI
            if title.contains("huddle") {
                return Some(MeetingPlatform::Slack);
            }
            // Slack calls
            if title.contains("slack call") {
                return Some(MeetingPlatform::Slack);
            }
            // Camera active in Slack = likely in a call
            if ctx.camera_active {
                return Some(MeetingPlatform::Slack);
            }
            // Don't match regular Slack workspace usage
            return None;
        }

        // Browser-based Slack
        if let Some(ref url) = ctx.url {
            if url.contains("app.slack.com") {
                // Check for huddle/call indicators
                if title.contains("huddle") || ctx.camera_active {
                    return Some(MeetingPlatform::Slack);
                }
            }
        }

        None
    }

    fn priority(&self) -> u32 {
        80
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slack_huddle() {
        let matcher = SlackMatcher;
        
        let ctx = MatchContext::new("Slack", "Huddle in #general")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::Slack));
    }

    #[test]
    fn test_slack_regular_usage() {
        let matcher = SlackMatcher;
        
        // Regular channel view should not match
        let ctx = MatchContext::new("Slack", "#engineering - Company Workspace");
        assert_eq!(matcher.matches(&ctx), None);
    }

    #[test]
    fn test_slack_with_camera() {
        let matcher = SlackMatcher;
        
        // Camera active in Slack = huddle/call
        let ctx = MatchContext::new("Slack", "#engineering - Company Workspace")
            .with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::Slack));
    }
}
