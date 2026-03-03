# NPM Package Publishing Plan

## Publishing @mostrom/meeting-detector as a Private Package

This document outlines the steps to publish this project as a private npm package under the `@mostrom` organization.

---

## Current Status ✅

Your project is already well-configured with:

- ✅ TypeScript compilation configured
- ✅ `.npmrc` configured for `@mostrom` scope
- ✅ Clean module exports in `src/index.ts`
- ✅ `prepublishOnly` script to build before publishing
- ✅ `files` array properly configured

---

## Required Changes

### 1. Update Package Name

**File:** `package.json`

Change the package name to include the organization scope:

```json
{
  "name": "@mostrom/meeting-detector"
}
```

### 2. Configure Private Package

**File:** `package.json`

Add publish configuration to ensure it's published as a private package:

```json
{
  "publishConfig": {
    "access": "restricted"
  }
}
```

### 3. Update Repository Information

**File:** `package.json`

Add complete metadata:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mostrom/harke-meeting-detector.git"
  },
  "author": "Your Name <your.email@example.com>",
  "homepage": "https://github.com/mostrom/harke-meeting-detector#readme",
  "bugs": {
    "url": "https://github.com/mostrom/harke-meeting-detector/issues"
  }
}
```

### 4. Verify .npmrc Configuration

Your `.npmrc` is correctly configured:

```
@mostrom:registry=https://registry.npmjs.org/
always-auth=true
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

### 5. Environment Variable Setup

Ensure `NPM_TOKEN` is properly configured:

**Locally:**
- Add to `.env`: `NPM_TOKEN=your-npm-token-here`
- Already exists ✅

**CI/CD (GitHub Actions):**
- Add `NPM_TOKEN` as a repository secret
- Settings → Secrets and variables → Actions → New repository secret

---

## Publishing Workflow

### Manual Publishing

```bash
# 1. Ensure you're on the main branch
git checkout main
git pull origin main

# 2. Ensure working directory is clean
git status

# 3. Update version (this will also create a git tag)
npm version patch  # or minor, or major

# 4. Publish to npm (build runs automatically via prepublishOnly)
npm publish

# 5. Push changes and tags to GitHub
git push --follow-tags
```

### Automated Publishing via GitHub Actions

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Package

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Pre-Flight Checklist

Before publishing for the first time:

- [ ] Update package name to `@mostrom/meeting-detector`
- [ ] Add `publishConfig` with `"access": "restricted"`
- [ ] Fill in repository, author, homepage, and bugs fields
- [ ] Verify `NPM_TOKEN` environment variable is set and valid
- [ ] Test the build: `npm run build`
- [ ] Verify dist outputs are correct
- [ ] Perform a dry run: `npm publish --dry-run`
- [ ] Inspect package contents: `npm pack` (creates tarball)
- [ ] Verify `.gitignore` excludes sensitive files
- [ ] Update README.md installation instructions

---

## Installation After Publishing

Once published, users within your organization can install with:

```bash
npm install @mostrom/meeting-detector
```

Or add to `package.json`:

```json
{
  "dependencies": {
    "@mostrom/meeting-detector": "^1.0.0"
  }
}
```

---

## Version Management Strategy

Follow semantic versioning (semver):

- **Patch** (1.0.x): Bug fixes, no breaking changes
  ```bash
  npm version patch
  ```

- **Minor** (1.x.0): New features, backward compatible
  ```bash
  npm version minor
  ```

- **Major** (x.0.0): Breaking changes
  ```bash
  npm version major
  ```

### Version Update Commands

```bash
# Patch release (1.0.0 → 1.0.1)
npm version patch -m "Fix: description of fix"

# Minor release (1.0.0 → 1.1.0)
npm version minor -m "Feature: description of feature"

# Major release (1.0.0 → 2.0.0)
npm version major -m "Breaking: description of breaking change"
```

---

## Troubleshooting

### Authentication Issues

If you get authentication errors:

1. Verify `NPM_TOKEN` is set:
   ```bash
   echo $NPM_TOKEN
   ```

2. Verify token has publish permissions for `@mostrom` scope

3. Ensure you're a member of the `@mostrom` organization on npm

### Permission Denied

If you get permission errors:

1. Verify organization membership
2. Check that the package name is scoped correctly (`@mostrom/meeting-detector`)
3. Ensure `publishConfig.access` is set to `"restricted"` for private packages

### Build Failures

If build fails during publish:

1. Run `npm run build` manually to see errors
2. Verify TypeScript configuration in `tsconfig.json`
3. Check that all imports use `.js` extensions (required for ESM)

---

## Security Considerations

1. **Never commit `.npmrc` with hardcoded tokens**
   - Always use `${NPM_TOKEN}` variable
   - Already configured correctly ✅

2. **Keep `.env` in `.gitignore`**
   - Verify: `grep .env .gitignore`
   - Already configured ✅

3. **Rotate tokens periodically**
   - Generate new token: https://www.npmjs.com/settings/~/tokens
   - Update in local `.env` and GitHub secrets

4. **Use automation tokens for CI/CD**
   - Not granular tokens
   - Scope to specific packages/organizations

---

## Next Steps

1. Review and implement the required changes in `package.json`
2. Test with `npm publish --dry-run`
3. Publish first version: `npm publish`
4. Set up automated publishing workflow (optional)
5. Update documentation with installation instructions
6. Share package name with team members

---

## Additional Resources

- [npm Private Packages Documentation](https://docs.npmjs.com/about-private-packages)
- [npm Organizations](https://docs.npmjs.com/organizations)
- [Semantic Versioning](https://semver.org/)
- [npm-version Documentation](https://docs.npmjs.com/cli/v9/commands/npm-version)
