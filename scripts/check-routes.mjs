#!/usr/bin/env bun
/**
 * Route hygiene gate (Phase 5.4).
 *
 * THE BUG THIS EXISTS TO KEEP FIXED
 *
 * Every file under `src/pages/` is a route. That is Astro's contract, not a
 * convention this repo agreed to, and it has teeth: `endpoints.test.ts` lived
 * in `src/pages/api/` and `bun run build` therefore emitted a **production
 * route** at `/api/endpoints.test` whose component was a test file importing
 * `bun:test`. Verified in the artifact — `dist/server/entry.mjs` carried
 *
 *     "route": "/api/endpoints.test",
 *     "component": "src/pages/api/endpoints.test.ts"
 *
 * so the whole suite — mocks, synthetic keys, assertions — shipped in the server
 * bundle and was reachable by anyone who guessed the URL.
 *
 * It was found only because `check:secrets` flagged a key-shaped literal in
 * `dist/server/chunks/endpoints_*.mjs`. The literal was a fake, so a secret
 * gate looking for real secrets would have reported PASS. The *path* was the
 * defect.
 *
 * WHAT IT CHECKS
 *
 *   1. No `*.test.*` / `*.spec.*` file under `src/pages/`.
 *   2. POSITIVE CONTROL: a planted file must be detected, because a check that
 *      finds nothing is indistinguishable from a check that is not looking.
 *   3. The built manifest must not register a route whose component path ends
 *      in `.test.` or `.spec.` — the belt to rule 1's braces, covering a test
 *      file that reached `dist/` some other way.
 *
 * Usage: `bun run check:routes` (run after `bun run build`).
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const PAGES = join('src', 'pages');
const ENTRY = join('dist', 'server', 'entry.mjs');
const TEST_FILE = /\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/;

let failures = 0;
const fail = (message) => {
	failures++;
	console.log(`FAIL  ${message}`);
};
const pass = (message) => console.log(`pass  ${message}`);

/** Every file under `dir`, recursively. */
function collect(dir) {
	/** @type {string[]} */
	const found = [];
	/** @type {string[]} */
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) stack.push(path);
			else found.push(path);
		}
	}
	return found;
}

console.log('=== positive control ===');
// A planted file the detector must reject. A check that cannot fail is not a
// check — the same reasoning `check:secrets.mjs` records, applied here.
const controlDir = mkdtempSync(join(tmpdir(), 'geminitts-route-gate-'));
const controlFile = join(controlDir, 'planted.test.ts');
writeFileSync(controlFile, 'export const GET = () => new Response("planted");\n');

const controlFound = TEST_FILE.test(controlFile);
rmSync(controlDir, { recursive: true, force: true });
if (!controlFound) {
	fail('positive control MISSED — the detector does not recognise a test file. The gate is broken; fix it before trusting any result below.');
} else {
	pass('detector recognises a planted test file');
}

console.log('\n=== source: no test file under src/pages/ ===');
if (!existsSync(PAGES)) {
	fail(`${PAGES} does not exist. This gate is scanning the wrong tree.`);
} else {
	const files = collect(PAGES);
	console.log(`info  scanned ${files.length} file(s) under ${PAGES}`);
	if (files.length === 0) fail('scanned 0 files — a zero-file scan is a false pass.');

	// `src/pages/**` is the Astro routing contract: anything in this tree
	// becomes a URL. Tests belong in `src/tests/` or beside the module they
	// cover, under `src/lib/`.
	const offenders = files.filter((path) => TEST_FILE.test(path));
	for (const path of offenders) {
		fail(`${relative(process.cwd(), path)} is a test file inside src/pages/ — Astro will build it as a live route. Move it to src/tests/ or beside the module it covers.`);
	}
	if (offenders.length === 0) pass('no test file under src/pages/');
}

console.log('\n=== build output: no test route registered ===');
if (!existsSync(ENTRY)) {
	// Not a failure when the build simply has not run — the source check above
	// is the one that matters. Reported so a stale dist/ is never mistaken for
	// a verified build.
	console.log(`info  ${ENTRY} not found — skipped. Run \`bun run build\` first.`);
} else {
	const manifest = readFileSync(ENTRY, 'utf8');
	// The manifest is a JSON island inside the bundle, so this is a text scan
	// for the shape that matters: a `component` pointing at a test file.
	const registered = [...manifest.matchAll(/"component":\s*"([^"]+)"/g)]
		.map((match) => match[1])
		.filter((component) => TEST_FILE.test(component));

	if (registered.length === 0) {
		pass('the built manifest registers no test route');
	} else {
		for (const component of new Set(registered)) {
			fail(`the built server registers ${component} as a route — it is reachable in production.`);
		}
	}
}

console.log(
	failures === 0
		? '\nRoute tree is clean. Nothing under src/pages/ ships unless it is a page.'
		: `\n${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
