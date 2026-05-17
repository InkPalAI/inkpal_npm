#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
REMOTE_URL="https://github.com/InkPalAI/inkpal_npm.git"

cd "$REPO_ROOT"

if ! git diff-index --quiet HEAD -- packages/inkpal-client/; then
  echo "✗ packages/inkpal-client/ has uncommitted changes. Commit them first:"
  git status --short -- packages/inkpal-client/
  exit 1
fi

PKG_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
VERSION="${1:-$PKG_VERSION}"

if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "✗ Requested $VERSION does not match package.json $PKG_VERSION."
  exit 1
fi

TAG="v$VERSION"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Releasing inkpal@$VERSION"
echo "  Tag:           $TAG"
echo "  Public mirror: $REMOTE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm view "inkpal@$VERSION" version > /dev/null 2>&1; then
  echo "✗ inkpal@$VERSION is already on npm."
  exit 1
fi
echo "✓ inkpal@$VERSION is not yet on npm."

echo ""
echo "→ Running prepublishOnly preflight ..."
(cd "$PKG_DIR" && npm run prepublishOnly > /dev/null)
echo "✓ preflight clean"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "→ Fetching public repo metadata ..."
git clone --quiet --depth 1 "$REMOTE_URL" "$TMPDIR/check"
cd "$TMPDIR/check"
git fetch --tags --quiet
if git rev-parse "$TAG" > /dev/null 2>&1; then
  echo "✗ Tag $TAG already exists in the public repo. Delete it first:"
  echo "  git push $REMOTE_URL :refs/tags/$TAG"
  exit 1
fi
EXISTING_TAGS="$(git tag -l 'v*')"

echo "→ Building fresh main from package contents ..."
mkdir -p "$TMPDIR/release"
cd "$TMPDIR/release"
git init --quiet --initial-branch=main
git remote add origin "$REMOTE_URL"

rsync -a \
  --exclude='.git' \
  --exclude='.inkpal' \
  --exclude='node_modules' \
  --exclude='bin' \
  --exclude='dist' \
  --exclude='*.tgz' \
  --exclude='.DS_Store' \
  --exclude='.npmrc' \
  --exclude='.env*' \
  --exclude='coverage' \
  --exclude='.vitest-cache' \
  --exclude='install.sh' \
  --exclude='build.sh' \
  --exclude='_*.mjs' \
  --exclude='inkpal-*.tgz' \
  "$PKG_DIR/" .

git add -A
if git diff --cached --quiet; then
  echo "✗ Nothing to commit — rsync produced empty tree. Aborting."
  exit 1
fi
git commit -m "release $TAG" > /dev/null
echo "✓ Committed release $TAG"

git tag -a "$TAG" -m "inkpal $VERSION"
git push --quiet --force origin main
git push --quiet origin "$TAG"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Published $TAG to public mirror"

if [ -n "$EXISTING_TAGS" ]; then
  echo ""
  echo "  Previous version tags preserved:"
  echo "$EXISTING_TAGS" | sed 's/^/    /'
fi

echo ""
echo "Watch the publish workflow:"
echo "  gh run watch --repo InkPalAI/inkpal_npm"
echo "  https://github.com/InkPalAI/inkpal_npm/actions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
