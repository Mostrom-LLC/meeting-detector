#!/usr/bin/env node
/**
 * napi-rs postinstall script
 * 
 * Verifies that the native binary is available for the current platform.
 * Falls back gracefully if binary is not available (for source installs).
 */

import { createRequire } from 'node:module';
import { platform, arch } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, '..');

// Platform to napi-rs binary name mapping
const PLATFORM_MAP = {
  'darwin-x64': 'meeting-detector-native.darwin-x64.node',
  'darwin-arm64': 'meeting-detector-native.darwin-arm64.node',
  'win32-x64': 'meeting-detector-native.win32-x64-msvc.node',
  'linux-x64': 'meeting-detector-native.linux-x64-gnu.node',
};

function getPlatformKey() {
  const p = platform();
  const a = arch();
  return `${p}-${a}`;
}

function checkNativeBinary() {
  const platformKey = getPlatformKey();
  const binaryName = PLATFORM_MAP[platformKey];
  
  if (!binaryName) {
    console.log(`[meeting-detector] No prebuilt binary for ${platformKey}`);
    console.log('[meeting-detector] Native features will not be available.');
    console.log('[meeting-detector] Detection will use shell fallback (macOS only).');
    return false;
  }
  
  // Check possible locations
  const locations = [
    join(packageDir, binaryName),
    join(packageDir, 'native', binaryName),
    join(packageDir, 'native', 'index.node'),
  ];
  
  for (const loc of locations) {
    if (existsSync(loc)) {
      console.log(`[meeting-detector] Found native binary: ${loc}`);
      return true;
    }
  }
  
  console.log(`[meeting-detector] Native binary not found for ${platformKey}`);
  console.log('[meeting-detector] Detection will use shell fallback if available.');
  return false;
}

// Run check
checkNativeBinary();
