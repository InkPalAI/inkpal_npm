# Publishing `inkpal` to npm

This package is published exclusively via the GitHub Actions workflow
in [`InkPalAI/inkpal_npm`](https://github.com/InkPalAI/inkpal_npm) with
Sigstore provenance attestation.

## How to publish a new version

1. Bump the version in `package.json`.
2. Run the release script from the working tree:
   ```
   ./scripts/release.sh
   ```
3. The script pushes a clean snapshot to `InkPalAI/inkpal_npm` and tags
   `v<version>`, which triggers the publish workflow.
4. After the workflow completes, verify the green
   "Built and signed on GitHub Actions" badge at
   <https://www.npmjs.com/package/inkpal>.

For a one-off publish, use the **Run workflow** button on the Actions
page and supply the version that matches `package.json`.

## Required one-time setup

These steps configure the npm side so the workflow can authenticate
and the package can carry a provenance attestation. Pick one auth path;
Trusted Publishers is recommended.

### Trusted Publishers (recommended)

1. Sign in at <https://www.npmjs.com/package/inkpal/access>.
2. Under **Trusted Publishers**, click **Add Trusted Publisher** →
   **GitHub Actions**.
3. Fill in:
   - Repository owner: `InkPalAI`
   - Repository name: `inkpal_npm`
   - Workflow filename: `publish-inkpal.yml`
4. Save. The workflow can now publish without an `NPM_TOKEN` secret.

### Granular access token (fallback)

1. Sign in at <https://www.npmjs.com/settings/~/tokens>.
2. **Generate New Token** → **Granular Access Token**.
3. Configure:
   - Expiration: ≤90 days
   - Permissions: **Read and write** for package `inkpal` only
4. Copy the token, then in the `InkPalAI/inkpal_npm` repo go to
   Settings → Secrets and variables → Actions → **New repository secret**:
   - Name: `NPM_TOKEN`
   - Value: the token from step 3
5. Enable 2FA on the npm account
   (`npm profile enable-2fa auth-and-writes`).

## How provenance verification works

After a successful publish:

```sh
npm view inkpal@<version> --json | jq '.dist.signatures'
npm audit signatures
```

`npm audit signatures` verifies the package's provenance attestation
against Sigstore and the GitHub OIDC issuer. If the package was
tampered with after publish, verification fails.

The provenance attestation is also published to the
[Sigstore transparency log](https://search.sigstore.dev) — anyone can
look up the signing identity (this exact workflow, this exact commit)
without trusting npm or us.

## What the workflow gates on (publish-blocking)

- Tag must be `v<version>` matching `package.json`
- Version must not already exist on npm
- `prepublishOnly` (build + prepublish-check) must pass
- All tests must pass
- `npm audit --omit=dev --audit-level=moderate` must report no findings
  in production dependencies

If any gate fails, no publish happens.

## Rotating credentials

- **NPM_TOKEN:** rotate every ≤90 days. Expired tokens fail the publish
  gracefully. Replace the secret and re-run.
- **Trusted Publishers:** no rotation needed.
- **GitHub OIDC:** automatic per-run, no rotation needed.

## In an incident

If a malicious version is published:

1. Deprecate immediately: `npm deprecate inkpal@<version> "<reason>"`
2. Unpublish if within 72h: `npm unpublish inkpal@<version>`
3. Rotate any tokens that may have been exposed.
4. Revoke the Trusted Publisher entry if the GitHub Actions workflow
   was the attack vector.
5. Open a GitHub Security Advisory in `InkPalAI/inkpal_npm`.
6. Notify users via the security disclosure channel in
   [SECURITY.md](./SECURITY.md).
