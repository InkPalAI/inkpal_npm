#!/usr/bin/env bash
# release.sh — Mirror packages/inkpal-client/ HEAD content to the public
# inkpal_npm repo as a clean single commit, then tag a release. The
# publish workflow runs in the public repo (free GHA minutes +
# provenance attestation).
#
# Why not `git subtree push`?
#   subtree push replays history, which (a) re-publishes any large blobs
#   that ever existed under packages/inkpal-client/ (we had old prebuilt
#   binaries that got swept in), and (b) can leak references to deleted
#   moat code in old commit messages. The clone-and-replace pattern
#   below gives us a clean, auditable per-release commit instead.
#
# Usage from monorepo root:
#   ./packages/inkpal-client/scripts/release.sh           # uses package.json version
#   ./packages/inkpal-client/scripts/release.sh 1.0.1     # explicit version
#
# Safety: the script never publishes directly. It only:
#   1. Verifies a clean monorepo working tree
#   2. Pushes a curated snapshot to the public repo's main branch
#   3. Tags v<version> on the public repo and pushes the tag
# The actual `npm publish` happens inside GitHub Actions in the public
# repo, gated by moat-guard, tests, and audit.

set -euo pipefail

# ── Resolve script + repo layout ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
REMOTE_URL="https://github.com/InkPalAI/inkpal_npm.git"

cd "$REPO_ROOT"

# ── Sanity: clean package subtree only ─────────────────────────────────
# The monorepo often has unrelated working-tree noise (benchmark outputs,
# scratch screenshots, etc.). Only the package directory matters for
# what we mirror to the public repo.
if ! git diff-index --quiet HEAD -- packages/inkpal-client/; then
  echo "✗ packages/inkpal-client/ has uncommitted changes. Commit them before releasing:"
  git status --short -- packages/inkpal-client/
  exit 1
fi

# ── Resolve version + monorepo SHA for traceability ────────────────────
PKG_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
VERSION="${1:-$PKG_VERSION}"
MONOREPO_SHA="$(git rev-parse HEAD)"
MONOREPO_SHA_SHORT="$(git rev-parse --short HEAD)"

if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "✗ Requested version ($VERSION) does not match package.json ($PKG_VERSION)."
  echo "  Bump packages/inkpal-client/package.json first."
  exit 1
fi

TAG="v$VERSION"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Releasing inkpal@$VERSION"
echo "  Source:        $PKG_DIR"
echo "  Source SHA:    $MONOREPO_SHA_SHORT (monorepo HEAD)"
echo "  Public mirror: $REMOTE_URL"
echo "  Tag:           $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Refuse if version already published to npm ─────────────────────────
if npm view "inkpal@$VERSION" version > /dev/null 2>&1; then
  echo "✗ inkpal@$VERSION is already on npm. Bump the version before re-releasing."
  exit 1
fi
echo "✓ inkpal@$VERSION is not yet on npm."

# ── Local moat-guard preflight (catches issues before pushing) ─────────
echo ""
echo "→ Running local prepublishOnly preflight (build + moat-guard) ..."
(cd "$PKG_DIR" && npm run prepublishOnly > /dev/null)
echo "✓ preflight clean"

# ── Clone public repo, check tag uniqueness, fetch existing tags ──────
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "→ Fetching public repo metadata (existing tags) ..."
git clone --quiet --depth 1 "$REMOTE_URL" "$TMPDIR/check"
cd "$TMPDIR/check"
git fetch --tags --quiet
if git rev-parse "$TAG" > /dev/null 2>&1; then
  echo "✗ Tag $TAG already exists in the public repo."
  echo "  Bump the version or delete the tag:"
  echo "  git push https://github.com/InkPalAI/inkpal_npm.git :refs/tags/$TAG"
  exit 1
fi
# Capture existing tags so we don't lose them on orphan force-push
EXISTING_TAGS="$(git tag -l 'v*')"

# ── Build a fresh orphan commit (zero history bloat, clean every release) ─
# Each release wipes the public repo's main branch to a single
# auto-generated commit. Per-version tags persist forever (they keep
# their commits alive for provenance verification), but the main
# branch never accumulates noise. This is the only way to guarantee
# the public repo can't carry over stale binaries, secrets, or moat
# IP from any previous push.
echo "→ Building fresh orphan main from monorepo HEAD ..."
mkdir -p "$TMPDIR/release"
cd "$TMPDIR/release"
git init --quiet --initial-branch=main
git remote add origin "$REMOTE_URL"

# Copy the curated package contents in. Excludes any path that contains
# runtime state, build artifacts, dev-only files, or anything that has
# ever leaked to a previous public push.
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
  --exclude='inkpal-*.tgz' \
  "$PKG_DIR/" .

# Stage everything as a single commit
git add -A
if git diff --cached --quiet; then
  echo "✗ Nothing to commit — rsync produced empty tree. Aborting."
  exit 1
else
  git commit -m "release $TAG

Mirrored from 01588/dartmind at $MONOREPO_SHA.

This is an auto-generated release commit. The source of truth is the
private monorepo. To browse historical changes, see:
  https://github.com/01588/dartmind/commits/master/packages/inkpal-client
" > /dev/null
  echo "✓ Committed release $TAG to public repo main."
fi

# Tag + push (force main since this is a fresh orphan commit;
# existing version tags are preserved because they're independent
# refs not reachable from main)
git tag -a "$TAG" -m "inkpal $VERSION (monorepo $MONOREPO_SHA_SHORT)"
git push --quiet --force origin main
git push --quiet origin "$TAG"

if [ -n "$EXISTING_TAGS" ]; then
  echo ""
  echo "  Note: $(echo "$EXISTING_TAGS" | wc -l | tr -d ' ') previous version tag(s) preserved:"
  echo "$EXISTING_TAGS" | sed 's/^/    /'
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Pushed clean snapshot + tag $TAG live in InkPalAI/inkpal_npm"
echo ""
echo "Watch the publish workflow:"
echo "  gh run watch --repo InkPalAI/inkpal_npm"
echo "Or open:"
echo "  https://github.com/InkPalAI/inkpal_npm/actions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
