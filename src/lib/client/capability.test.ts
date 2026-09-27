import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serverAvailable } from './capability';

/**
 * `serverAvailable` is one comparison, and almost all of its value is in the
 * claim that makes it true: a non-empty `BASE_URL` means "this is the static
 * GitHub Pages deployment", because `astro.config.mjs` is the only thing in the
 * project that sets `base`, and it sets it only under `PAGES_TARGET === 'pages'`.
 *
 * That claim is invisible to every other part of the toolchain. `astro check`
 * sees a valid config, the build sees a valid static build, and a server build
 * that also grew a `base` would produce a bundle that type-checks, bundles, and
 * serves — while quietly pointing every page's default provider at a host that
 * is not there. So it is asserted here, against the config file itself.
 */

// Resolved from the module URL so the assertion holds whatever cwd the test
// runner was started from.
const configPath = fileURLToPath(new URL('../../../astro.config.mjs', import.meta.url));
const config = readFileSync(configPath, 'utf8');
const configLines = config.split('\n');

/** Lines carrying a top-level-ish `key:` assignment, ignoring comment prose. */
function linesDeclaring(key: string): string[] {
  return configLines.filter((line) => {
    const code = line.replace(/\/\/.*$/, '');
    return new RegExp(`(^|[\\s{,])${key}\\s*:`).test(code);
  });
}

describe('serverAvailable', () => {
  it('is true at the domain root', () => {
    expect(serverAvailable('/')).toBe(true);
  });

  // Astro emits `''` for a `base` that is configured empty, which is still
  // mounted at `/`; treating it as static would deny every root-mounted build a
  // server it has.
  it('is true for an empty base', () => {
    expect(serverAvailable('')).toBe(true);
  });

  // The Pages deployment, and the value `astro.config.mjs` actually emits.
  it('is false for the static Pages base path', () => {
    expect(serverAvailable('/GeminiTTS/')).toBe(false);
  });

  // Under `bun test` there is no Vite env, so `import.meta.env.BASE_URL` is
  // undefined and the default argument falls back to `'/'`. Asserted so a
  // change to that fallback fails here rather than as a mystery in every other
  // suite that calls `readMode()` with no argument.
  it('defaults to true under bun test, where BASE_URL is undefined', () => {
    expect(serverAvailable()).toBe(true);
  });
});

describe('the base-path / static-output coupling in astro.config.mjs', () => {
  it('declares exactly one base, and only inside the PAGES conditional', () => {
    const baseLines = linesDeclaring('base');
    expect(baseLines).toHaveLength(1);

    // Scoped to the nearest enclosing spread, not to the surrounding lines: the
    // `output` line above also mentions PAGES, so a wider window would pass
    // even after someone deleted the `PAGES ?` guard off the base itself.
    const index = configLines.indexOf(baseLines[0]);
    const opener = [baseLines[0], ...configLines.slice(Math.max(0, index - 3), index)].find((line) =>
      line.includes('...(')
    );

    // Loose enough to survive a spread broken across lines — the `...(` and its
    // `PAGES ?` guard stay within a line or two of the `base` key — and tight
    // enough to fail the day someone gives the *server* build a base path.
    expect(opener).toBeDefined();
    expect(opener).toContain('PAGES');
  });

  it('emits static output for PAGES and server output otherwise', () => {
    const outputLines = linesDeclaring('output');
    expect(outputLines).toHaveLength(1);
    expect(outputLines[0]).toContain("PAGES ? 'static' : 'server'");
  });
});
