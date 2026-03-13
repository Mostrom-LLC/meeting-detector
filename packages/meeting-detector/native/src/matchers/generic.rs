//! Generic matcher for other meeting platforms.
//!
//! This matcher handles platforms that don't have dedicated matchers,
//! using process name and window title patterns.

use super::{MatchContext, PlatformMatcher};
use crate::types::MeetingPlatform;

/// Generic matcher for various meeting platforms.
#[derive(Debug, Default)]
pub struct GenericMatcher;

impl GenericMatcher {
    /// Match patterns for various platforms.
    const PATTERNS: &'static [(&'static str, &'static [&'static str], MeetingPlatform)] = &[
        // (process_contains, title_contains, platform)
        ("webex", &["meeting", "call"], MeetingPlatform::CiscoWebex),
        (
            "discord",
            &["voice", "call", "video"],
            MeetingPlatform::Discord,
        ),
        ("facetime", &[], MeetingPlatform::FaceTime),
        ("skype", &["call", "meeting"], MeetingPlatform::Skype),
        ("whereby", &[], MeetingPlatform::Whereby),
        ("gotomeeting", &[], MeetingPlatform::GoToMeeting),
        ("bluejeans", &[], MeetingPlatform::BlueJeans),
        ("jitsi", &[], MeetingPlatform::JitsiMeet),
        ("8x8", &[], MeetingPlatform::EightByEight),
        ("ringcentral", &[], MeetingPlatform::RingCentral),
        ("bigbluebutton", &[], MeetingPlatform::BigBlueButton),
        ("chime", &[], MeetingPlatform::AmazonChime),
        ("hangouts", &[], MeetingPlatform::GoogleHangouts),
        ("connect", &["adobe"], MeetingPlatform::AdobeConnect),
        ("teamviewer", &[], MeetingPlatform::TeamViewer),
        ("anydesk", &[], MeetingPlatform::AnyDesk),
        ("clickmeeting", &[], MeetingPlatform::ClickMeeting),
        ("appear.in", &[], MeetingPlatform::AppearIn),
    ];

    /// URL patterns for browser-based meetings.
    const URL_PATTERNS: &'static [(&'static str, MeetingPlatform)] = &[
        ("webex.com", MeetingPlatform::CiscoWebex),
        ("discord.com", MeetingPlatform::Discord),
        ("whereby.com", MeetingPlatform::Whereby),
        ("gotomeeting.com", MeetingPlatform::GoToMeeting),
        ("bluejeans.com", MeetingPlatform::BlueJeans),
        ("jitsi.org", MeetingPlatform::JitsiMeet),
        ("meet.jit.si", MeetingPlatform::JitsiMeet),
        ("8x8.vc", MeetingPlatform::EightByEight),
        ("ringcentral.com", MeetingPlatform::RingCentral),
        ("bigbluebutton", MeetingPlatform::BigBlueButton),
        ("chime.aws", MeetingPlatform::AmazonChime),
        ("hangouts.google.com", MeetingPlatform::GoogleHangouts),
        ("appear.in", MeetingPlatform::AppearIn),
    ];
}

impl PlatformMatcher for GenericMatcher {
    fn matches(&self, ctx: &MatchContext) -> Option<MeetingPlatform> {
        let process = ctx.process_name.to_lowercase();
        let title = ctx.window_title.to_lowercase();

        // Check URL patterns first (most reliable)
        if let Some(ref url) = ctx.url {
            let url_lower = url.to_lowercase();
            for (pattern, platform) in Self::URL_PATTERNS {
                if url_lower.contains(pattern) {
                    return Some(*platform);
                }
            }
        }

        // Check process + title patterns
        for (process_pattern, title_patterns, platform) in Self::PATTERNS {
            if process.contains(process_pattern) {
                // If no title patterns required, match immediately
                if title_patterns.is_empty() {
                    return Some(*platform);
                }
                // Otherwise, check if any title pattern matches
                for title_pattern in *title_patterns {
                    if title.contains(title_pattern) {
                        return Some(*platform);
                    }
                }
                // If camera is active, match even without title pattern
                if ctx.camera_active {
                    return Some(*platform);
                }
            }
        }

        None
    }

    fn priority(&self) -> u32 {
        10 // Low priority - fallback after specific matchers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webex_detection() {
        let matcher = GenericMatcher;

        let ctx =
            MatchContext::new("Cisco Webex Meetings", "Team Meeting").with_camera_active(true);
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::CiscoWebex));
    }

    #[test]
    fn test_facetime_detection() {
        let matcher = GenericMatcher;

        // FaceTime matches on process name alone
        let ctx = MatchContext::new("FaceTime", "");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::FaceTime));
    }

    #[test]
    fn test_discord_url() {
        let matcher = GenericMatcher;

        let ctx = MatchContext::new("Google Chrome", "Voice Channel")
            .with_url("https://discord.com/channels/123/456");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::Discord));
    }

    #[test]
    fn test_jitsi_meet() {
        let matcher = GenericMatcher;

        let ctx = MatchContext::new("Firefox", "Team Meeting")
            .with_url("https://meet.jit.si/TeamSync123");
        assert_eq!(matcher.matches(&ctx), Some(MeetingPlatform::JitsiMeet));
    }

    #[test]
    fn test_unknown_process() {
        let matcher = GenericMatcher;

        let ctx = MatchContext::new("SomeUnknownApp", "Random Window");
        assert_eq!(matcher.matches(&ctx), None);
    }
}
