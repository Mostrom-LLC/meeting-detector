#!/usr/bin/env swift
// media-state.swift — Checks active camera/mic capture sessions on macOS.
// Outputs JSON: {"camera":true/false,"mic":true/false}
//
// Uses AVCaptureDevice.isInUseByAnotherApplication which checks for active
// capture sessions, NOT device presence. This is the correct API — pgrep for
// VDCAssistant only checks if the camera daemon process exists (always true
// on Macs with connected cameras).

import AVFoundation

let videoSession = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInWideAngleCamera, .external],
    mediaType: .video,
    position: .unspecified
)

let audioSession = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.microphone, .external],
    mediaType: .audio,
    position: .unspecified
)

let cameraActive = videoSession.devices.contains { $0.isInUseByAnotherApplication }
let micActive = audioSession.devices.contains { $0.isInUseByAnotherApplication }

print("{\"camera\":\(cameraActive),\"mic\":\(micActive)}")
