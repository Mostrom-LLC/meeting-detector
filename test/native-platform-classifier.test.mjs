import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNativeMeeting,
  classifyPlatformFromNativeApp,
  classifyNativeProcessCommand,
} from '../dist/classifiers/native-platform.js';

test('classifies native slack huddle from process and title', () => {
  const result = classifyNativeMeeting({
    process: 'Slack',
    windowTitle: 'Huddle in #engineering',
    micActive: true,
    cameraActive: false,
  });

  assert.equal(result, 'Slack');
});

test('does not classify native Slack without huddle title evidence', () => {
  assert.equal(
    classifyNativeMeeting({
      process: 'Slack',
      windowTitle: 'Slack',
      micActive: true,
      cameraActive: false,
    }),
    null
  );
});

test('classifies native Teams process identity without browser context', () => {
  assert.equal(
    classifyPlatformFromNativeApp({
      frontApp: 'Microsoft Teams',
      process: 'MSTeams',
      windowTitle: 'Planning Sync | Microsoft Teams',
    }),
    'Microsoft Teams'
  );
});

test('classifies Teams from browser-wrapped meeting URL', () => {
  assert.equal(
    classifyPlatformFromNativeApp({
      process: 'Google Chrome Helper',
      frontApp: 'Google Chrome',
      windowTitle: 'Join the meeting now | Microsoft Teams',
      chromeUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting@thread.v2/0',
    }),
    'Microsoft Teams'
  );
});

test('classifies native Zoom processes from ps command output', () => {
  assert.equal(
    classifyNativeProcessCommand('/Applications/zoom.us.app/Contents/MacOS/zoom.us'),
    'Zoom'
  );
});

test('does not classify native Zoom idle window title', () => {
  assert.equal(
    classifyNativeMeeting({
      process: 'zoom.us',
      windowTitle: 'Zoom Workplace',
      micActive: true,
      cameraActive: false,
    }),
    null
  );
});

test('classifies native Webex meeting windows when mic is active', () => {
  assert.equal(
    classifyNativeMeeting({
      process: 'webexmta',
      windowTitle: 'Weekly staff meeting - Webex',
      micActive: true,
      cameraActive: false,
    }),
    'Cisco Webex'
  );
});

test('does not classify idle Teams launcher title', () => {
  assert.equal(
    classifyNativeMeeting({
      process: 'MSTeams',
      windowTitle: 'Microsoft Teams',
      micActive: true,
      cameraActive: false,
    }),
    null
  );
});

test('does not classify without mic activity', () => {
  assert.equal(
    classifyNativeMeeting({
      process: 'Webex',
      windowTitle: 'Webex Meeting',
      micActive: false,
      cameraActive: true,
    }),
    null
  );
});
