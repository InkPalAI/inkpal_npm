# Security policy — `inkpal`

## Reporting a vulnerability

Email **security@inkpal.ai** with:

- A description of the issue
- Reproduction steps (or a proof-of-concept)
- Affected version(s)
- Your assessment of impact

Please do **not** open a public GitHub issue for security reports.

We aim to acknowledge within 48 hours and ship a fix within 14 days for
high-severity issues. Responsible disclosure credit is given in the
release notes unless you ask to remain anonymous.

## Scope

In scope:

- The `inkpal` npm package (this repository)
- The InkPal MCP server binary shipped in this package
- Communication with the InkPal cloud API at `mcp.inkpal.ai`

Out of scope:

- The Dart `inkpal_bridge` package — report at `security@inkpal.ai`
  with subject `[bridge]`
- The InkPal cloud platform — report at `security@inkpal.ai` with
  subject `[cloud]`

## Supply chain posture

- The published tarball contains only compiled JavaScript from `dist/`,
  the bundled tool schemas, README, LICENSE, CHANGELOG, SECURITY, and
  `package.json`.
- No `postinstall`, `preinstall`, or other install-time scripts.
- No source maps. No environment files. No secrets.
- Tarball contents verifiable with `npm pack --dry-run`.
- A `prepublishOnly` script runs a scanner that blocks the publish if
  any forbidden identifier appears in the compiled output.

## Provenance attestation

Every published version carries a [Sigstore][sigstore] provenance
attestation produced by the
[`publish-inkpal.yml`](https://github.com/InkPalAI/inkpal_npm/blob/main/.github/workflows/publish-inkpal.yml)
GitHub Actions workflow using GitHub OIDC. This cryptographically ties
each tarball to the exact source commit, workflow run, and repository
identity.

Verify locally:

```sh
npm view inkpal@<version> --json | jq '.dist.signatures'
npm audit signatures
```

The signing identity is also published to the public Sigstore
transparency log — anyone can verify the package without trusting npm
or the InkPal team. See [PUBLISHING.md](./PUBLISHING.md) for the
publishing workflow.

## Runtime posture

- All outbound network traffic is to a single fixed cloud base URL
  (`mcp.inkpal.ai`, overridable via `INKPAL_API_URL`). No user-controlled
  hostnames are reachable through proxy code paths.
- License keys are read from the `INKPAL_LICENSE_KEY` environment
  variable. They are never logged, never persisted to disk outside the
  user's `~/.inkpal/` config directory, and only sent over HTTPS to the
  cloud base URL.
- Telemetry is fire-and-forget, anonymous (device hash, no key, no PII),
  and disabled by `INKPAL_TELEMETRY=off`.
- File-system operations use Node's native `fs` API. Shell calls (where
  unavoidable for SDK invocations) never interpolate user-controlled
  paths.

## Known non-issues

- `npm audit` may report vulnerabilities in `devDependencies`
  (`vitest`, `vite`, `esbuild`). These are dev-only and do not ship
  in the published tarball.

## Versions supported

Security fixes are issued for the latest minor release on each major
version. Older releases are best-effort.

[sigstore]: https://www.sigstore.dev/
