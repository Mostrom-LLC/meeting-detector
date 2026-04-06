// Cypress E2E support file
// Auth: user logs into Google manually once in cypress open, session persists.

// Ignore uncaught exceptions from third-party meeting apps
Cypress.on('uncaught:exception', () => {
  return false;
});
