import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
describe('Install invariants — never regress these again', () => {
    const startSrc = readFileSync(join(PKG_ROOT, 'src/start.ts'), 'utf8');
    const cliSrc = readFileSync(join(PKG_ROOT, 'src/cli.ts'), 'utf8');
    it('start.ts uses correct npx args (inkpal-mcp binary, not bare inkpal)', () => {
        expect(startSrc).toMatch(/['"]inkpal-mcp['"]/);
        const badFormInInstall = /config\[.*\]\['inkpal'\]\s*=\s*\{[\s\S]{0,400}args:\s*\[\s*['"]-y['"]\s*,\s*['"]inkpal@latest['"]\s*\]/;
        expect(startSrc).not.toMatch(badFormInInstall);
    });
    it('cli.ts uses correct npx args (inkpal-mcp binary)', () => {
        expect(cliSrc).toMatch(/['"]inkpal-mcp['"]/);
    });
    it('start.ts writes Claude Code MCP to ~/.claude.json (not settings.json)', () => {
        expect(startSrc).toMatch(/claude:\s*\{\s*path:\s*join\(\s*HOME\s*,\s*['"]\.claude\.json['"]\s*\)/);
        expect(startSrc).not.toMatch(/claude:\s*\{\s*path:\s*join\(\s*HOME\s*,\s*['"]\.claude['"]\s*,\s*['"]settings\.json['"]\s*\)/);
    });
    it('cli.ts writes Claude Code MCP to ~/.claude.json', () => {
        expect(cliSrc).toMatch(/claude:[\s\S]{0,300}configPath:\s*join\(\s*HOME\s*,\s*['"]\.claude\.json['"]\s*\)/);
    });
    it('start.ts BRIDGE_VERSION is at least ^1.4.x (pub.dev current floor)', () => {
        const m = startSrc.match(/BRIDGE_VERSION\s*=\s*['"]\^?(\d+)\.(\d+)\.(\d+)['"]/);
        expect(m).toBeTruthy();
        const major = parseInt(m![1], 10);
        const minor = parseInt(m![2], 10);
        expect(major).toBeGreaterThanOrEqual(1);
        if (major === 1)
            expect(minor).toBeGreaterThanOrEqual(4);
    });
    it('no source file contains a /Users/tezz/... hardcoded path', () => {
        const startHardcode = /\/Users\/tezz\//.exec(startSrc);
        expect(startHardcode, 'start.ts contains /Users/tezz/... hardcoded path').toBeNull();
        const cliHardcode = /\/Users\/tezz\//.exec(cliSrc);
        expect(cliHardcode, 'cli.ts contains /Users/tezz/... hardcoded path').toBeNull();
    });
    it('package.json declared files all exist (README.md, LICENSE)', () => {
        const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
        for (const file of pkg.files as string[]) {
            if (file.includes('*'))
                continue;
            expect(existsSync(join(PKG_ROOT, file)), `package.json declares "${file}" but it doesn't exist`).toBe(true);
        }
    });
    it('Codex IDE is supported (5th editor in compatibility matrix)', () => {
        expect(cliSrc).toMatch(/codex:\s*\{[\s\S]{0,200}name:\s*['"]OpenAI Codex/);
        expect(startSrc).toMatch(/codex:\s*\{[\s\S]{0,200}path:\s*join\(\s*HOME\s*,\s*['"]\.codex['"]/);
    });
    it('telemetry can be opted out via INKPAL_TELEMETRY=off', () => {
        const serverSrc = readFileSync(join(PKG_ROOT, 'src/server.ts'), 'utf8');
        expect(serverSrc).toMatch(/INKPAL_TELEMETRY\s*!==?\s*['"]off['"]/);
    });
    it('README documents telemetry opt-out', () => {
        const readme = readFileSync(join(PKG_ROOT, 'README.md'), 'utf8');
        expect(readme).toMatch(/INKPAL_TELEMETRY/);
        expect(readme).toMatch(/opt out/i);
    });
});
