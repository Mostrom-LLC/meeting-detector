# Lessons Learned - @mostrom/meeting-detector Publishing

## 2026-03-03: Initial npm Publishing Setup

### Key Learnings

1. **Private npm packages require explicit configuration**
   - Must set `publishConfig.access: "restricted"` in package.json
   - Without this, publish will fail or create public package
   - Requires paid npm Teams/Enterprise organization

2. **.npmrc best practices**
   - Use `${NPM_TOKEN}` environment variable, never hardcode tokens
   - The `always-auth=true` setting is deprecated in npm 9+
   - Minimum required config for scoped packages:
     ```
     @scope:registry=https://registry.npmjs.org/
     //registry.npmjs.org/:_authToken=${NPM_TOKEN}
     ```

3. **Scoped packages naming**
   - Format: `@organization/package-name`
   - Must match npm organization you belong to
   - Enables private packages under paid npm plans
   - All import statements must use the scoped name

4. **GitHub Actions for npm publishing**
   - Use `NODE_AUTH_TOKEN` env var in actions context (not `NPM_TOKEN`)
   - Run on macOS runner for platform-specific packages
   - Always include dry-run step before actual publish
   - Trigger on tags (v*) for controlled releases
   - Requires NPM_TOKEN secret in GitHub repository settings

5. **Pre-publish verification**
   - Always run `npm publish --dry-run` first
   - Use `npm pack` to inspect exact package contents
   - Verify `files` array in package.json includes all necessary files
   - Check `.gitignore` excludes sensitive files (.env, .npmrc with tokens)

6. **TypeScript package considerations**
   - Must include `prepublishOnly` script to build before publish
   - Include both .js and .d.ts files in `files` array
   - Source maps (.js.map, .d.ts.map) improve debugging experience
   - Keep `dist/` in .gitignore, always build fresh for publish

7. **Version management**
   - `npm version` automatically creates git tags
   - Use `--follow-tags` when pushing to include version tags
   - Tags trigger automated publish workflows
   - Semantic versioning: patch (bugs), minor (features), major (breaking)

8. **Package metadata importance**
   - Repository URL helps with discoverability and trust
   - Homepage provides easy access to documentation
   - Bugs URL makes issue reporting straightforward
   - Author field adds credibility and contact information

### Mistakes to Avoid

- Don't commit .npmrc with hardcoded tokens (use ${NPM_TOKEN} variable)
- Don't forget to add NPM_TOKEN to GitHub secrets for automated publishing
- Don't publish without testing dry-run first
- Don't forget to update README.md with new scoped package name
- Don't skip repository metadata (helps with discoverability and trust)
- Don't use deprecated npm configurations like `always-auth=true`

### Future Improvements

- Consider adding `npm run test` step before publish
- Add package size monitoring
- Consider provenance publishing for supply chain security
- Add automated changelog generation from git commits
- Set up automated version bumping based on commit messages (conventional commits)

### Related Documentation

- [npm Private Packages](https://docs.npmjs.com/about-private-packages)
- [npm Organizations](https://docs.npmjs.com/organizations)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions - Publishing Node.js packages](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)

## 2026-03-07: Meeting Detector Platform Audit

### User Correction Pattern

1. **When the user points to a specific tool API path, validate usage against docs immediately**
   - Correction received: use CMUX browser APIs directly from CLI docs
   - Prevention rule: if user gives a tool doc URL, inspect it right away and realign test strategy before continuing assumptions

2. **Differentiate tool capability from environment capability early**
   - CMUX browser APIs worked, but browser panels are embedded web views and did not produce expected media entitlement behavior in this environment
   - Prevention rule: after confirming command syntax, run a fast capability probe (mic/camera event sanity check) before full scenario automation

3. **Credential helper scripts may use different env var names than project `.env`**
   - OTP scripts expected `GOOGLE_EMAIL`/`GOOGLE_APP_PASSWORD`, while project had `GMAIL_EMAIL`/`GMAIL_APP_PASSWORD`
   - Prevention rule: check script env var contract first and map variables explicitly in command invocation

## 2026-03-07: Verification Discipline Reinforcement

1. **Do not close robustness work without baseline-vs-change proof**
   - Correction pattern: user required explicit verification gates before marking complete.
   - Prevention rule: for behavior changes, run side-by-side `HEAD` vs working-tree scenarios and capture concrete event/log deltas.

2. **Use logs as acceptance evidence, not just assertions**
   - Correction pattern: synthetic test pass/fail alone was insufficient.
   - Prevention rule: include debug-log evidence showing the decision path (for example, `Parsed signal` vs `Holding low-confidence signal`) for at least one key scenario.

## 2026-03-07: Autonomous Bug-Fix Execution

1. **Bug reports should trigger direct fix execution, not guidance requests**
   - Correction pattern: user requested no hand-holding during bug reports.
   - Prevention rule: when a concrete bug is reported, immediately reproduce, patch, verify, and report results with evidence unless a true external blocker exists.

## 2026-03-14: Completion Criteria Must Match the Explicit Platform List

1. **Do not close meeting-detector validation until every platform named by the user has a live passing scenario**
   - Correction pattern: reporting partial coverage as if the task was complete was rejected.
   - Prevention rule: when the user names concrete platforms such as Slack, Zoom, Teams, and Google Meet, track each one explicitly and do not claim completion until each has a recorded live-pass result, not merely probes or blockers.

## 2026-03-14: Join-State Validation Must Match the User's Definition of "In the Meeting"

1. **For Teams, waiting room or prejoin evidence is not enough when the user expects a full join**
   - Correction pattern: the user clarified that the Teams scenario must enter a display name and submit `Join`, not stop at the preview screen.
   - Prevention rule: when validating a meeting platform, explicitly confirm whether the workflow must reach joined state, waiting room, or prejoin, and default to the deeper joined state if the user says "sign all the way into the meeting."
