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
