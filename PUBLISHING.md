# Publishing `inkpal` to npm

This package is developed in the private monorepo
[`01588/dartmind`](https://github.com/01588/dartmind) under
`packages/inkpal-client/`, then published to npm via the public mirror
repo [`InkPalAI/inkpal_npm`](https://github.com/InkPalAI/inkpal_npm).

The public mirror exists because **npm provenance attestation requires
a publicly verifiable source repo** and **public repos get free GitHub
Actions minutes** — both of which make the standalone repo strictly
better than publishing from the private monorepo.

## How to publish a new version (operator workflow)

From the monorepo root:

```sh
# 1. Bump version in packages/inkpal-client/package.json
# 2. Commit the bump to uat (or master, whichever you release from)
# 3. Run the release script:
./packages/inkpal-client/scripts/release.sh
```

The script:

1. Pushes the latest `packages/inkpal-client/` subtree to the public
   `InkPalAI/inkpal_npm` repo's `main` branch
2. Tags `v<version>` on the public repo
3. Pushes the tag, which triggers the publish workflow

The workflow (`.github/workflows/publish-inkpal.yml` inside the public
repo) then builds, runs tests, audits dependencies, and publishes to
npm with `--provenance` — all on free public-repo GHA minutes.

If you prefer to do it by hand:

```sh
cd /path/to/monorepo

# Push subtree to public repo
git subtree push --prefix=packages/inkpal-client inkpal_npm main

# Tag + push on the public repo
git clone git@github.com:InkPalAI/inkpal_npm.git /tmp/inkpal_npm
cd /tmp/inkpal_npm
VERSION="$(node -p 'require("./package.json").version')"
git tag "v$VERSION"
git push origin "v$VERSION"
```

The first push needs the `inkpal_npm` remote configured in the monorepo:

```sh
git remote add inkpal_npm git@github.com:InkPalAI/inkpal_npm.git
```

After the workflow runs, verify the published package shows the green
"Built and signed with GitHub Actions" badge at
<https://www.npmjs.com/package/inkpal>.

## Required one-time setup

These steps configure the **npm side** so the workflow can authenticate
and the package can carry a provenance attestation. Pick **one** auth
path; Trusted Publishers is recommended.

### Auth path A (recommended): Trusted Publishers

Trusted Publishers replaces long-lived `NPM_TOKEN` secrets with on-demand
OIDC tokens — nothing to store, nothing to rotate.

1. Sign in at <https://www.npmjs.com/package/inkpal/access>.
2. Under **Trusted Publishers**, click **Add Trusted Publisher** →
   **GitHub Actions**.
3. Fill in:
   - Repository owner: `InkPalAI`
   - Repository name: `inkpal_npm`
   - Workflow filename: `publish-inkpal.yml`
   - Environment: `production-npm` (optional — see below)
4. Save. The workflow can now publish without an `NPM_TOKEN` secret.

### Auth path B (fallback): granular access token

If you can't use Trusted Publishers:

1. Sign in at <https://www.npmjs.com/settings/~/tokens>.
2. **Generate New Token** → **Granular Access Token**.
3. Configure:
   - Expiration: ≤90 days (rotate before expiry)
   - Permissions: **Read and write** for package `inkpal` only
4. Copy the token, then in the `InkPalAI/inkpal_npm` repo go to
   Settings → Secrets and variables → Actions → **New repository secret**:
   - Name: `NPM_TOKEN`
   - Value: the token from step 3
5. **Enable 2FA** on the npm account
   (`npm profile enable-2fa auth-and-writes`) — required for any account
   that owns a published package.

### Optional: `production-npm` environment with required reviewers

For a human approval gate on every publish:

1. In `InkPalAI/inkpal_npm`, go to Settings → Environments → New
   environment.
2. Name it `production-npm` (matches the workflow's `environment.name`).
3. Add **Required reviewers** under deployment protection rules.
4. Optionally add a **Wait timer** (e.g. 5 minutes — gives time to
   abort).

If the environment doesn't exist, the workflow runs without the gate.

## How provenance verification works

After a successful publish:

```sh
npm view inkpal@<version> --json | jq '.dist.signatures'
npm audit signatures
```

`npm audit signatures` walks the dependency tree and verifies each
package's provenance attestation against Sigstore + the GitHub OIDC
issuer. If any package was tampered with after publish, this fails.

The provenance attestation is also published to the
[Sigstore transparency log](https://search.sigstore.dev) — anyone can
look up the signing identity (this exact workflow, this exact commit)
without trusting npm or us.

## What the workflow gates on (publish-blocking)

- Tag must be `v<version>` matching `package.json`
- Version must not already exist on npm
- `prepublishOnly` (build + moat-guard) must pass
- All tests must pass
- `npm audit --omit=dev --audit-level=moderate` must report no findings
  in production dependencies

If any gate fails, no publish happens, no token is exposed.

## Rotating credentials

- **NPM_TOKEN:** rotate every ≤90 days. Expired tokens fail the publish
  gracefully — the workflow's last step (`npm publish`) errors but
  nothing else is exposed. Replace the secret and re-run.
- **Trusted publishers:** no rotation needed (no long-lived credential).
- **GitHub OIDC:** automatic per-run, no rotation needed.

## In an incident

If a malicious version is published:

1. **Deprecate immediately:** `npm deprecate inkpal@<version> "<reason>"`
2. **Unpublish if within 72h:** `npm unpublish inkpal@<version>`
3. **Rotate** any tokens that may have been exposed.
4. **Revoke trusted publisher** if the attack vector was via the
   GitHub Actions workflow.
5. Open a GitHub Security Advisory in `InkPalAI/inkpal_npm`.
6. Notify users via the security disclosure channel in
   [SECURITY.md](./SECURITY.md).
