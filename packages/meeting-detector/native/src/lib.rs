use napi_derive::napi;

#[napi(string_enum)]
pub enum MeetingPlatform {
  Zoom,
  GoogleMeet,
  MicrosoftTeams,
  Slack,
  Webex,
  Discord,
  FaceTime,
  Skype,
  Whereby,
  Unknown,
}

#[napi(object)]
pub struct DetectorScaffoldInfo {
  pub runtime: String,
  pub platform: String,
  pub arch: String,
  pub status: String,
}

#[napi]
pub fn scaffold_info() -> DetectorScaffoldInfo {
  DetectorScaffoldInfo {
    runtime: "napi-rs".to_string(),
    platform: std::env::consts::OS.to_string(),
    arch: std::env::consts::ARCH.to_string(),
    status: "scaffold-ready".to_string(),
  }
}

#[napi]
pub fn normalize_platform(input: String) -> MeetingPlatform {
  match input.to_lowercase().as_str() {
    "zoom" => MeetingPlatform::Zoom,
    "google meet" | "meet" => MeetingPlatform::GoogleMeet,
    "microsoft teams" | "teams" => MeetingPlatform::MicrosoftTeams,
    "slack" => MeetingPlatform::Slack,
    "webex" | "cisco webex" => MeetingPlatform::Webex,
    "discord" => MeetingPlatform::Discord,
    "facetime" | "face time" => MeetingPlatform::FaceTime,
    "skype" => MeetingPlatform::Skype,
    "whereby" => MeetingPlatform::Whereby,
    _ => MeetingPlatform::Unknown,
  }
}
