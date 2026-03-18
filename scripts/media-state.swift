#!/usr/bin/env swift
// media-state.swift — Checks active camera/mic hardware state on macOS.
// Outputs JSON: {"camera":true/false,"mic":true/false}
//
// Mic: CoreAudio HAL kAudioDevicePropertyDeviceIsRunningSomewhere — checks
// the hardware driver directly. Works for all consumers (AVCaptureSession,
// CoreMedia, WebRTC, anything that opens the device for I/O).
//
// Camera: Process proxy — VDCAssistant (pre-Ventura) or AppleCameraAssistant
// (Ventura+) is spawned by the OS whenever any app accesses the camera and
// stays alive for the duration. There's no clean HAL equivalent for camera,
// but this daemon is a reliable proxy.

import CoreAudio
import Foundation

func isAnyAudioInputRunning() -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
    ) == noErr else { return false }

    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var devices = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices
    ) == noErr else { return false }

    for device in devices {
        // Only check devices that have input streams (microphones)
        var inputAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var streamSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            device, &inputAddress, 0, nil, &streamSize
        ) == noErr else { continue }
        if streamSize == 0 { continue }

        var isRunning: UInt32 = 0
        var runSize = UInt32(MemoryLayout<UInt32>.size)
        var runAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        if AudioObjectGetPropertyData(
            device, &runAddress, 0, nil, &runSize, &isRunning
        ) == noErr && isRunning != 0 {
            return true
        }
    }
    return false
}

func isCameraInUse() -> Bool {
    let pipe = Pipe()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    process.arguments = ["-xq", "VDCAssistant"]
    process.standardOutput = pipe
    process.standardError = pipe
    do {
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus == 0 { return true }
    } catch {}

    let process2 = Process()
    process2.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    process2.arguments = ["-xq", "AppleCameraAssistant"]
    process2.standardOutput = Pipe()
    process2.standardError = Pipe()
    do {
        try process2.run()
        process2.waitUntilExit()
        if process2.terminationStatus == 0 { return true }
    } catch {}

    return false
}

let mic = isAnyAudioInputRunning()
let cam = isCameraInUse()
print("{\"camera\":\(cam),\"mic\":\(mic)}")
