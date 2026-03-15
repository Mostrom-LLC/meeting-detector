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

## 2026-03-14: Match Response Length to the User's Requested Format

1. **When the user asks for a simple checklist, do not return a long narrative**
   - Correction pattern: the user explicitly rejected an overly long checklist-style response.
   - Prevention rule: if the user asks for a simple checklist or concise format, compress the response to the minimum actionable items and move detail into files only if needed.

## 2026-03-14: CLI Simplifications Must Be Re-Verified Against Live Browser and Native Signals

1. **When changing the direct dev notifier, verify real browser/native meeting paths instead of relying only on synthetic tests**
   - Correction pattern: the user reported that browser and native app meetings stopped surfacing after the CLI output was simplified.
   - Prevention rule: after changing notification wiring in `src/index.ts`, run at least one live browser-based signal check and one native-shaped regression check before treating the change as safe.

## 2026-03-14: Do Not Paper Over Missing Attribution by Forcing Unknown Browser Meetings

1. **Respect `emitUnknown` even when browser camera usage looks strong**
   - Correction pattern: bypassing `emitUnknown` caused false-positive `Unknown` meetings for generic browser camera usage.
   - Prevention rule: if browser-based meetings disappear, fix the attribution path that maps real meeting routes to a concrete platform instead of letting unattributed browser camera activity through by default.

2. **Do not route macOS production detection through a parallel state machine unless it has feature parity with the JS heuristics**
   - Correction pattern: the Rust macOS path ignored the JS URL/service heuristics that real browser and helper-process meeting detection depends on, so tests passed while live meetings stopped emitting lifecycle events.
   - Prevention rule: when two detection pipelines exist, keep the user-facing path on the one with verified live parity until the replacement path is explicitly validated against browser and native meeting scenarios.

## 2026-03-14: CLI Output Should Hide Undefined Lifecycle Fields

1. **Do not dump optional lifecycle properties when they are unset**
   - Correction pattern: the direct CLI output showed `previous_platform: undefined` and `raw_signal: undefined`, which adds noise without helping the operator.
   - Prevention rule: for human-facing notifier output, print only the populated fields that matter for the current event instead of logging the entire lifecycle object verbatim.

## 2026-03-14: The Direct CLI Entry Point Needs Its Own Regression Coverage

1. **Do not optimize the CLI notifier around `meeting_started` alone**
   - Correction pattern: subscribing only to `meeting_started` hid valid later meetings during platform handoffs and same-platform rejoins.
   - Prevention rule: the shipped `npm run dev` / `node dist/index.js` path must handle `meeting_started`, `meeting_changed`, and a debounced raw-signal fallback for same-platform handoffs.

2. **Do not disable startup probing in the CLI without replacing mid-call detection**
   - Correction pattern: turning off `startupProbe` made the CLI appear idle when launched during an already-active meeting.
   - Prevention rule: keep startup probing enabled for the direct notifier unless there is another explicit path that surfaces the current in-progress call state.

## 2026-03-14: Browser Validation Must Use the Target Platforms, Not Generic Stand-Ins

1. **Do not treat non-target browser checks as proof that Teams, Slack, Meet, and Zoom work**
   - Correction pattern: validating with unrelated browser pages and Jitsi did not prove the named browser meeting platforms actually worked.
   - Prevention rule: when the user names concrete browser meeting platforms, capture evidence for those exact platforms or explicitly mark the remaining ones as blocked manual checks.

2. **When adding browser probing, verify the real redirected routes produced by the platforms**
   - Correction pattern: Teams browser detection still failed until the matcher learned the real `launcher.html?...type=meetup-join` rewrite route, and Google Meet still failed when the tab title collapsed to plain `Meet`.
   - Prevention rule: after adding or changing browser URL matchers, inspect the live resolved tab URLs/titles from the actual browser session and add regression tests for those exact rewritten routes and generic-title cases.

## 2026-03-14: Browser Probes Must Not Launch Unrelated Apps

1. **Do not script inactive browser apps by name during discovery**
   - Correction pattern: probing `Microsoft Edge` by name launched the wrong app and spammed Parallels dialogs on the user’s desktop.
   - Prevention rule: keep the default macOS browser probe list side-effect free by filtering to already-running browsers first and excluding problematic apps like `Microsoft Edge` unless they are explicitly re-enabled with a validated test path.

## 2026-03-14: Live Browser Routes Matter More Than Assumed Platform URLs

1. **Match the exact consumer Teams route produced by the live browser session**
   - Correction pattern: `teams.live.com/light-meetings/launch?...` was a real Chrome meeting page, but the matcher only handled `teams.live.com/meet/...` and older `teams.microsoft.com/...` routes, so live Teams browser sessions emitted nothing.
   - Prevention rule: when validating browser meetings, capture the final resolved URL from the actual tab and add a regression test for that exact route before treating the platform as covered.

2. **Slack browser huddles can surface as titled popup windows with `about:blank` URLs**
   - Correction pattern: the real Chrome huddle window appeared as `Huddle: #general - Mostrom, LLC - Slack` / `Slack - Huddle Preview` while AppleScript reported `about:blank`, so URL-only Slack matching missed live huddles.
   - Prevention rule: for Chromium popup windows, use constrained title-based matching when the live platform opens a meeting surface on `about:blank`, and add a negative test so regular workspace tabs still stay suppressed.

## 2026-03-15: Browser Probe Gating Must Degrade Gracefully on macOS

1. **Do not make browser meeting detection depend solely on `System Events`**
   - Correction pattern: filtering probe targets from `System Events` process names caused all browser meetings to disappear when that query failed, even though direct browser AppleScript tab queries could still succeed.
   - Prevention rule: use a process-table-first check for side-effect-free browser gating, and if running-app discovery still fails, fall back to the direct browser probe list instead of returning no targets.

2. **Active Edge sessions are part of the supported macOS browser surface**
   - Correction pattern: removing `Microsoft Edge` from the probe list fixed one launch side effect but regressed real Edge-hosted meetings for users already in a call.
   - Prevention rule: keep `Microsoft Edge` in the supported probe list, but only suppress inactive-app launches via the running-process gate rather than by deleting Edge support entirely.

## 2026-03-15: Generic Browser Pages Must Never Inherit the Previous Meeting Platform

1. **Use exact meeting-route matchers in every browser classification path**
   - Correction pattern: after a real browser meeting ended, visiting generic `teams.live.com/v2/` or `app.zoom.us/wc/home` still emitted `Microsoft Teams` or `Zoom` because the raw signal parser matched broad hosts and route prefixes.
   - Prevention rule: centralize browser URL classification behind one exact-route helper shared by the tab probe, raw signal parser, and strong-evidence gate; do not classify a platform from a generic host or broad prefix alone.

2. **Add lifecycle regressions for post-call browser handoffs, not just standalone URL matching**
   - Correction pattern: the false positives only appeared after a prior real meeting, so simple matcher tests were insufficient to prove the bug was fixed.
   - Prevention rule: when a browser false positive depends on prior meeting state, add a lifecycle test that starts a real meeting, lets it end or nearly end, then browses the generic page and asserts there is no `meeting_changed` or new `meeting_started`.

## 2026-03-15: Teams Web Can Use a Generic `/v2/` URL With Only the Title Proving Join State

1. **Do not assume the Teams meeting URL itself always carries the join semantics**
   - Correction pattern: a real admitted Teams web meeting was live at `https://teams.live.com/v2/`, which looked like a generic landing page unless the tab title `Meet | Meeting with ... | Microsoft Teams` was considered.
   - Prevention rule: for Teams web, support the current consumer `/v2/` route only when the title explicitly indicates a live meeting, and keep the plain `teams.live.com/v2/` landing page negative.

2. **Do not drop browser meeting titles just because `front_app` is the host browser**
   - Correction pattern: `front_app=Google Chrome` caused stabilization to discard a valid Teams meeting title even though the URL+title pair already proved the platform.
   - Prevention rule: when a browser route/title matcher already identifies a platform, preserve that title through context stabilization even if the front app is just Chrome or Safari.

## 2026-03-15: Browser Tabs Are Attribution Hints, Not Standalone Meeting Evidence

1. **Do not synthesize `allowed` browser meetings from tab presence alone**
   - Correction pattern: the detector emitted `Microsoft Teams` before join because `pollBrowserMeetingTabs()` converted matching tabs directly into synthetic high-confidence meeting signals even when mic/camera were not active.
   - Prevention rule: browser probing may cache route/title context for attribution, but it must not start lifecycle events by itself; lifecycle must come from a real media-use signal.

2. **Keep prejoin Teams `/v2/` titles negative even if they look meeting-adjacent**
   - Correction pattern: the title `Meet | Microsoft Teams` appeared before the meeting started and was incorrectly treated as a joined meeting.
   - Prevention rule: only treat Teams `/v2/` as joined when the title carries a stronger admitted-meeting shape such as `Meeting with ...`, and verify the prejoin title explicitly stays silent in runtime, not just in matcher tests.

## 2026-03-15: Global Camera State Is Not Sufficient Evidence For Native Meetings

1. **Do not treat `VDCAssistant`/camera-daemon activity as a native meeting by itself**
   - Correction pattern: the camera daemon was active on this Mac even while idle native Teams was merely open, which caused false `Microsoft Teams` meetings when the native probe trusted camera state alone.
   - Prevention rule: native macOS meeting starts must require stronger evidence than global camera activity, with microphone activity as the primary gate and app/window context only as attribution.

2. **Suppress generic native app windows even when helper processes are noisy**
   - Correction pattern: idle native Teams and Zoom windows with generic titles like `Microsoft Teams` or `Zoom Workplace` still produced false positives through helper-process/TCC churn.
   - Prevention rule: treat generic native app windows as non-meetings by default; only escalate when the media-use gate is satisfied and the native app context is stronger than an idle home/chat surface.
