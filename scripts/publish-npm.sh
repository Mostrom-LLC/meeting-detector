#!/usr/bin/env sh
set -eu

usage() {
  cat <<USAGE
Usage:
  ./scripts/publish-npm.sh [--version <version>] [--tag <tag>] [--access <restricted|public>] [--otp <code>] [--dry-run]

Examples:
  ./scripts/publish-npm.sh                         # Publish current version
  ./scripts/publish-npm.sh --version patch         # Bump patch version and publish
  ./scripts/publish-npm.sh --version minor         # Bump minor version and publish
  ./scripts/publish-npm.sh --version major         # Bump major version and publish
  ./scripts/publish-npm.sh --version 1.0.1         # Set specific version and publish
  ./scripts/publish-npm.sh --tag next              # Publish with 'next' tag
  ./scripts/publish-npm.sh --access restricted     # Publish as private package
  ./scripts/publish-npm.sh --dry-run               # Test without publishing
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION=""
TAG="latest"
ACCESS="restricted"
OTP=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|-v)
      VERSION="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --access)
      ACCESS="${2:-}"
      shift 2
      ;;
    --otp)
      OTP="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Validate access
case "$ACCESS" in
  restricted|public) ;;
  *)
    echo "Error: --access must be 'restricted' or 'public' (got: $ACCESS)" >&2
    exit 1
    ;;
esac

cd "$ROOT_DIR"

# Load NPM_TOKEN from .env if not already set
if [ -z "${NPM_TOKEN:-}" ] && [ -f "${ROOT_DIR}/.env" ]; then
  echo "==> Loading NPM_TOKEN from .env"
  # shellcheck disable=SC2046
  export $(grep -E "^NPM_TOKEN=" .env | xargs)
fi

# Set up temporary npmrc with token
if [ -n "${NPM_TOKEN:-}" ]; then
  TMP_DIR="$(mktemp -d)"
  cleanup() {
    rm -rf "$TMP_DIR"
  }
  trap cleanup 0 1 2 3 15

  AUTH_NPMRC="${TMP_DIR}/.npmrc"
  printf "//registry.npmjs.org/:_authToken=%s\n" "$NPM_TOKEN" > "$AUTH_NPMRC"
  export NPM_CONFIG_USERCONFIG="$AUTH_NPMRC"
  export npm_config_userconfig="$AUTH_NPMRC"

  echo "==> NPM_TOKEN configured"
fi

# Verify authentication
if ! npm whoami >/dev/null 2>&1; then
  if [ -t 0 ] && [ -t 1 ] && [ -z "${CI:-}" ]; then
    echo "==> npm authentication missing; launching npm login"
    npm login || true
  fi

  if ! npm whoami >/dev/null 2>&1; then
    echo "Error: npm authentication not available. Ensure NPM_TOKEN is valid or run 'npm login'." >&2
    exit 1
  fi
fi

NPM_USER="$(npm whoami)"
echo "==> Authenticated as: ${NPM_USER}"

# Get current package info
PACKAGE_NAME="$(node -p "require('./package.json').name")"
CURRENT_VERSION="$(node -p "require('./package.json').version")"
echo "==> Package: ${PACKAGE_NAME}"
echo "==> Current version: ${CURRENT_VERSION}"

# Handle version bump if specified
if [ -n "$VERSION" ]; then
  case "$VERSION" in
    patch|minor|major)
      echo "==> Bumping ${VERSION} version"
      npm version "$VERSION" --no-git-tag-version
      NEW_VERSION="$(node -p "require('./package.json').version")"
      echo "==> New version: ${NEW_VERSION}"
      ;;
    [0-9]*)
      echo "==> Setting version to ${VERSION}"
      npm version "$VERSION" --no-git-tag-version
      ;;
    *)
      echo "Error: Invalid version: $VERSION" >&2
      echo "Must be 'patch', 'minor', 'major', or a semver version (e.g., 1.0.1)" >&2
      exit 1
      ;;
  esac
fi

PUBLISH_VERSION="$(node -p "require('./package.json').version")"

# Build the package
echo "==> Building package"
npm run build

# Auto-increment version if current version exists on registry
if [ -z "$VERSION" ]; then
  EXISTING_VERSION="$(npm view "${PACKAGE_NAME}@${PUBLISH_VERSION}" version 2>/dev/null || true)"
  if [ "$EXISTING_VERSION" = "$PUBLISH_VERSION" ]; then
    echo "==> Version ${PUBLISH_VERSION} already exists, auto-incrementing to next patch version"
    npm version patch --no-git-tag-version
    PUBLISH_VERSION="$(node -p "require('./package.json').version")"
    echo "==> New version: ${PUBLISH_VERSION}"
  fi
else
  # If version was explicitly set, check if it already exists
  if [ "$DRY_RUN" -eq 0 ]; then
    EXISTING_VERSION="$(npm view "${PACKAGE_NAME}@${PUBLISH_VERSION}" version 2>/dev/null || true)"
    if [ "$EXISTING_VERSION" = "$PUBLISH_VERSION" ]; then
      echo "Error: ${PACKAGE_NAME}@${PUBLISH_VERSION} already exists on npm registry" >&2
      echo "Cannot publish the same version twice" >&2
      exit 1
    fi
  fi
fi

# Publish the package
echo "==> Publishing ${PACKAGE_NAME}@${PUBLISH_VERSION}"
if [ "$DRY_RUN" -eq 1 ]; then
  npm publish --access "$ACCESS" --tag "$TAG" --dry-run
  echo "==> Dry run completed successfully"
else
  if [ -n "$OTP" ]; then
    npm publish --access "$ACCESS" --tag "$TAG" --otp "$OTP"
  else
    npm publish --access "$ACCESS" --tag "$TAG"
  fi
  echo "==> Published ${PACKAGE_NAME}@${PUBLISH_VERSION}"
  echo "==> View at: https://www.npmjs.com/package/${PACKAGE_NAME}"
fi

echo "==> Done"
