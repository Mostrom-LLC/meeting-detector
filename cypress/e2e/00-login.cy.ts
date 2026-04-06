/**
 * Manual Google login step.
 * Run this first in cypress open — log into Google manually,
 * then the provider tests will use the authenticated session.
 */
describe('Google Login', () => {
  it('navigate to Google sign-in (log in manually)', () => {
    cy.visit('https://accounts.google.com/signin');
    // Pause here — log in manually in the Cypress browser.
    // Once logged in, click "Resume" in the Cypress UI to continue.
    cy.pause();
  });

  it('verify login succeeded', () => {
    cy.visit('https://meet.google.com');
    cy.wait(3000);
    // If logged in, should see "New meeting" button, not "Sign in"
    cy.contains(/new meeting/i, { timeout: 15_000 }).should('be.visible');
  });
});
