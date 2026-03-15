import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchBrowserMeetingTab } from '../dist/detector.js';

test('matches Google Meet meeting tabs by code route', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'abc-defg-hij - Google Meet',
    url: 'https://meet.google.com/abc-defg-hij',
  }), 'Google Meet');
});

test('matches Zoom web meeting tabs', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Zoom',
    url: 'https://app.zoom.us/wc/8716769399/join?pwd=test',
  }), 'Zoom');
});

test('matches Microsoft Teams web meeting tabs', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Join the meeting now | Microsoft Teams',
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_test',
  }), 'Microsoft Teams');
});

test('matches Microsoft Teams launcher rewrite routes', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Join conversation',
    url: 'https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F_%23%2Fl%2Fmeetup-join%2F19%3Ameeting_test&type=meetup-join',
  }), 'Microsoft Teams');
});

test('matches Microsoft Teams live consumer meeting routes', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Microsoft Teams meeting | Microsoft Teams',
    url: 'https://teams.live.com/light-meetings/launch?anon=true&lightExperience=true',
  }), 'Microsoft Teams');
});

test('matches Microsoft Teams v2 meeting surfaces when the title indicates a live meeting', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Meet | Meeting with kaise white | Microsoft Teams',
    url: 'https://teams.live.com/v2/',
  }), 'Microsoft Teams');
});

test('does not match Microsoft Teams v2 prejoin pages', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Meet | Microsoft Teams',
    url: 'https://teams.live.com/v2/',
  }), null);
});

test('does not match Microsoft Teams landing pages', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Microsoft Teams',
    url: 'https://teams.live.com/v2/',
  }), null);
});

test('matches Slack huddle tabs by app route and title', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Huddle in development - Slack',
    url: 'https://app.slack.com/client/T05AXT2C65P/C0AGWNWB2MV/huddle',
  }), 'Slack');
});

test('matches Slack huddle preview popups even when Chrome reports about:blank', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Slack - Huddle Preview',
    url: 'about:blank',
  }), 'Slack');
});

test('does not match Google Meet landing pages', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Google Meet',
    url: 'https://meet.google.com/',
  }), null);
});

test('does not match generic Zoom web pages under /wc without a meeting join route', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Zoom Workplace',
    url: 'https://app.zoom.us/wc/home',
  }), null);
});

test('does not match regular Slack workspace tabs', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'development (Channel) - Mostrom, LLC - Slack',
    url: 'https://app.slack.com/client/T05AXT2C65P/C0AGWNWB2MV',
  }), null);
});

test('does not match Slack docs or feature pages that mention huddles', () => {
  assert.equal(matchBrowserMeetingTab({
    browser: 'Google Chrome',
    title: 'Use huddles in Slack',
    url: 'https://app.slack.com/features/huddles',
  }), null);
});
