//! Error types for meeting-detector.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use thiserror::Error;

/// Errors that can occur during meeting detection.
#[derive(Error, Debug)]
pub enum DetectorError {
    #[error("Permission denied: {reason}")]
    PermissionDenied { reason: String },

    #[error("Platform not supported")]
    PlatformNotSupported,

    #[error("API unavailable: {api}")]
    ApiUnavailable { api: String },

    #[error("Parse error: {message}")]
    ParseError { message: String },

    #[error("Already running")]
    AlreadyRunning,

    #[error("Not running")]
    NotRunning,

    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl From<DetectorError> for napi::Error {
    fn from(err: DetectorError) -> Self {
        match &err {
            DetectorError::PermissionDenied { .. } => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
            DetectorError::PlatformNotSupported => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
            DetectorError::ApiUnavailable { .. } => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
            DetectorError::ParseError { .. } => {
                napi::Error::new(napi::Status::InvalidArg, err.to_string())
            }
            DetectorError::AlreadyRunning => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
            DetectorError::NotRunning => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
            DetectorError::Internal { .. } => {
                napi::Error::new(napi::Status::GenericFailure, err.to_string())
            }
        }
    }
}

/// Result type for detector operations.
pub type DetectorResult<T> = Result<T, DetectorError>;

/// Error info exposed to JavaScript.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct DetectorErrorInfo {
    pub code: String,
    pub message: String,
}

impl From<DetectorError> for DetectorErrorInfo {
    fn from(err: DetectorError) -> Self {
        let code = match &err {
            DetectorError::PermissionDenied { .. } => "PERMISSION_DENIED",
            DetectorError::PlatformNotSupported => "PLATFORM_NOT_SUPPORTED",
            DetectorError::ApiUnavailable { .. } => "API_UNAVAILABLE",
            DetectorError::ParseError { .. } => "PARSE_ERROR",
            DetectorError::AlreadyRunning => "ALREADY_RUNNING",
            DetectorError::NotRunning => "NOT_RUNNING",
            DetectorError::Internal { .. } => "INTERNAL_ERROR",
        };
        Self {
            code: code.to_string(),
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = DetectorError::PermissionDenied {
            reason: "No Full Disk Access".to_string(),
        };
        assert!(err.to_string().contains("Permission denied"));
        assert!(err.to_string().contains("No Full Disk Access"));
    }

    #[test]
    fn test_error_info_conversion() {
        let err = DetectorError::PlatformNotSupported;
        let info: DetectorErrorInfo = err.into();
        assert_eq!(info.code, "PLATFORM_NOT_SUPPORTED");
    }
}
