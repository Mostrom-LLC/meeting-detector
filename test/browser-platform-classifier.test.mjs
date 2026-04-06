import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBrowserMeeting,
  classifyBrowserMeetingTab,
} from '../dist/classifiers/browser-platform.js';

test('classifies Google Meet meeting code routes', () => {
  assert.equal(
    classifyBrowserMeeting('https://meet.google.com/abc-defg-hij', 'abc-defg-hij - Google Meet'),
    'Google Meet'
  );
});

test('does not classify Google Meet landing pages', () => {
  assert.equal(
    classifyBrowserMeeting('https://meet.google.com/landing', 'Google Meet'),
    null
  );
});

test('classifies Zoom /j routes', () => {
  assert.equal(
    classifyBrowserMeeting('https://zoom.us/j/123456789', 'Zoom'),
    'Zoom'
  );
});

test('classifies Zoom /wc join routes', () => {
  assert.equal(
    classifyBrowserMeeting('https://zoom.us/wc/123456789/join', 'Zoom'),
    'Zoom'
  );
});

test('does not classify Zoom /wc home pages', () => {
  assert.equal(
    classifyBrowserMeeting('https://app.zoom.us/wc/home', 'Zoom Workplace'),
    null
  );
});

test('classifies Teams meetup-join links', () => {
  assert.equal(
    classifyBrowserMeeting(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc@thread.v2/0',
      'Join the meeting now | Microsoft Teams'
    ),
    'Microsoft Teams'
  );
});

test('classifies Teams v2 meetingjoin pages', () => {
  assert.equal(
    classifyBrowserMeeting(
      'https://teams.live.com/v2/?meetingjoin=true',
      'Microsoft Teams meeting | Microsoft Teams'
    ),
    'Microsoft Teams'
  );
});

test('keeps Teams v2 prejoin pages negative', () => {
  assert.equal(
    classifyBrowserMeeting('https://teams.live.com/v2/', 'Meet | Microsoft Teams'),
    null
  );
});

test('classifies Slack huddle routes', () => {
  assert.equal(
    classifyBrowserMeeting(
      'https://app.slack.com/client/T123/C123/huddle',
      'Huddle in #engineering - Slack'
    ),
    'Slack'
  );
});

test('classifies Slack huddle preview title when URL is about:blank', () => {
  assert.equal(
    classifyBrowserMeeting('about:blank', 'Slack - Huddle Preview'),
    'Slack'
  );
});

test('does not classify Slack workspace channel pages', () => {
  assert.equal(
    classifyBrowserMeeting(
      'https://app.slack.com/client/T123/C123',
      'engineering (Channel) - Mostrom, LLC - Slack'
    ),
    null
  );
});

test('classifies Webex browser meetings', () => {
  assert.equal(
    classifyBrowserMeeting('https://web.webex.com/meet/mostrom-room', 'Mostrom Room | Webex'),
    'Cisco Webex'
  );
});

test('classifies Webex subdomain join meetings', () => {
  assert.equal(
    classifyBrowserMeeting('https://mostrom.webex.com/join/meeting-id', 'Join session | Webex'),
    'Cisco Webex'
  );
});

test('does not classify Webex marketing pages', () => {
  assert.equal(
    classifyBrowserMeeting('https://www.webex.com/', 'Webex Suite'),
    null
  );
});

test('classifies tab objects via the shared browser matcher', () => {
  assert.equal(
    classifyBrowserMeetingTab({
      browser: 'Google Chrome',
      title: 'Zoom',
      url: 'https://zoom.us/j/123456789',
    }),
    'Zoom'
  );
});
