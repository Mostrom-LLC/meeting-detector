/**
 * Meeting detection E2E tests.
 *
 * Each test: navigate to provider → create instant meeting →
 * verify meeting_started → leave → verify meeting_ended.
 *
 * Auth: Chrome launches with a copy of the user's Profile 28 (agent@mostrom.io),
 * so all platforms that accept "Sign in with Google" are pre-authenticated.
 *
 * Prerequisite: MeetingDetector is controlled via cy.task() in Node.
 */

interface ProviderConfig {
  id: string;
  platform: string;
  envKey: string;
  createMeeting: () => void;
  joinMeeting: () => void;
  leaveMeeting: () => void;
}

const providers: ProviderConfig[] = [
  {
    id: 'google-meet-web',
    platform: 'Google Meet',
    envKey: 'E2E_GOOGLE_MEET_URL',
    createMeeting() {
      cy.contains(/new meeting/i, { timeout: 15_000 }).should('be.visible').click();
      cy.wait(1000);
      cy.contains(/start an instant meeting/i, { timeout: 5_000 }).should('be.visible').click();
      cy.wait(3000);
    },
    joinMeeting() {
      cy.get('body').then(($body) => {
        if ($body.text().match(/join now|ask to join/i)) {
          cy.contains(/join now|ask to join/i).first().click();
        }
      });
      cy.wait(3000);
    },
    leaveMeeting() {
      cy.get('[aria-label*="Leave" i], [aria-label*="hang up" i], [data-tooltip*="Leave" i]')
        .first()
        .click({ force: true });
    },
  },
  {
    id: 'teams-web',
    platform: 'Microsoft Teams',
    envKey: 'E2E_TEAMS_WEB_URL',
    createMeeting() {
      // Handle "Continue on this browser" if it appears
      cy.get('body').then(($body) => {
        if ($body.text().match(/continue on this browser|join on the web/i)) {
          cy.contains(/continue on this browser|join on the web/i).first().click();
          cy.wait(2000);
        }
      });
      cy.contains(/meet now|start a meeting|new meeting/i, { timeout: 15_000 })
        .should('be.visible')
        .click();
      cy.wait(3000);
    },
    joinMeeting() {
      cy.get('body').then(($body) => {
        if ($body.text().match(/join now/i)) {
          cy.contains(/join now/i).first().click();
        }
      });
      cy.wait(3000);
    },
    leaveMeeting() {
      cy.contains(/leave|hang up/i).first().click({ force: true });
    },
  },
  {
    id: 'zoom-web',
    platform: 'Zoom',
    envKey: 'E2E_ZOOM_WEB_URL',
    createMeeting() {
      cy.contains(/host a meeting|new meeting|start meeting/i, { timeout: 15_000 })
        .should('be.visible')
        .click();
      cy.wait(3000);
      // Zoom often shows "Join from Your Browser" instead of launching native
      cy.get('body').then(($body) => {
        if ($body.text().match(/join from your browser|launch meeting/i)) {
          cy.contains(/join from your browser|launch meeting/i).first().click();
          cy.wait(3000);
        }
      });
    },
    joinMeeting() {
      cy.get('body').then(($body) => {
        if ($body.text().match(/join audio by computer/i)) {
          cy.contains(/join audio by computer/i).first().click();
        } else if ($body.text().match(/join/i)) {
          cy.contains(/^join$/i).first().click();
        }
      });
      cy.wait(3000);
    },
    leaveMeeting() {
      cy.contains(/leave meeting|end meeting|leave/i).first().click({ force: true });
    },
  },
  {
    id: 'slack-huddle-web',
    platform: 'Slack',
    envKey: 'E2E_SLACK_HUDDLE_WEB_URL',
    createMeeting() {
      cy.wait(5000); // Let Slack fully load
      // Start a Huddle via button or headphone icon
      cy.get('body').then(($body) => {
        const huddleBtn = $body.find(
          'button[aria-label*="huddle" i], button[data-qa="huddle-trigger"]'
        );
        if (huddleBtn.length > 0) {
          cy.wrap(huddleBtn.first()).click();
        } else {
          cy.contains(/start a huddle|huddle/i).first().click();
        }
      });
      cy.wait(3000);
    },
    joinMeeting() {
      cy.get('body').then(($body) => {
        if ($body.text().match(/join huddle|join audio/i)) {
          cy.contains(/join huddle|join audio|join/i).first().click();
        }
      });
      cy.wait(3000);
    },
    leaveMeeting() {
      cy.contains(/leave|end huddle/i).first().click({ force: true });
    },
  },
  {
    id: 'webex-web',
    platform: 'Cisco Webex',
    envKey: 'E2E_WEBEX_WEB_URL',
    createMeeting() {
      cy.contains(/start a meeting|meet now|start meeting/i, { timeout: 15_000 })
        .should('be.visible')
        .click();
      cy.wait(3000);
      cy.get('body').then(($body) => {
        if ($body.text().match(/join from your browser/i)) {
          cy.contains(/join from your browser/i).first().click();
          cy.wait(3000);
        }
      });
    },
    joinMeeting() {
      cy.get('body').then(($body) => {
        if ($body.text().match(/join meeting|start meeting/i)) {
          cy.contains(/join meeting|start meeting/i).first().click();
        } else if ($body.text().match(/join/i)) {
          cy.contains(/^join$/i).first().click();
        }
      });
      cy.wait(3000);
    },
    leaveMeeting() {
      cy.contains(/leave meeting|end meeting|leave/i).first().click({ force: true });
    },
  },
];

describe('Meeting Detection — Web Providers', () => {
  for (const provider of providers) {
    describe(provider.platform, () => {
      const url = Cypress.env(provider.envKey);

      before(function () {
        if (!url) {
          this.skip();
          return;
        }
        cy.task('startDetector', provider.id);
      });

      after(() => {
        cy.task('stopDetector');
      });

      it(`detects meeting_started and meeting_ended`, function () {
        if (!url) this.skip();

        // Navigate to provider landing page
        cy.visit(url);
        cy.wait(3000);

        // Create an instant meeting
        cy.task('log', `Creating meeting on ${provider.platform}...`);
        provider.createMeeting();

        // Join the meeting
        cy.task('log', `Joining meeting...`);
        provider.joinMeeting();

        // Wait for meeting_started from the detector
        cy.task('log', 'Waiting for meeting_started...');
        cy.task(
          'waitForEvent',
          { eventName: 'meeting_started', timeoutMs: 60_000 },
          { timeout: 65_000 }
        ).then((event: any) => {
          expect(event.platform).to.equal(provider.platform);
          expect(event.started_at).to.be.a('string');
          cy.task('log', `meeting_started: platform=${event.platform}`);
        });

        // Leave the meeting
        cy.task('log', 'Leaving meeting...');
        provider.leaveMeeting();

        // Wait for meeting_ended from the detector
        cy.task('log', 'Waiting for meeting_ended...');
        cy.task(
          'waitForEvent',
          { eventName: 'meeting_ended', timeoutMs: 60_000 },
          { timeout: 65_000 }
        ).then((event: any) => {
          expect(event.platform).to.equal(provider.platform);
          expect(event.ended_at).to.be.a('string');
          cy.task('log', `meeting_ended: platform=${event.platform}`);
        });
      });
    });
  }
});
