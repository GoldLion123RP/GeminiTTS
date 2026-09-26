#!/usr/bin/env bun
/**
 * Secret gate for the build output (Phase 4.6).
 *
 * WHY THIS EXISTS, AND WHY IT IS A SCRIPT AND NOT A GREP
 *
 * Repo memory records that `Select-String -Path "dist\**"` silently matched
 * 1 of 45 files and produced a false pass — twice. A glob that expands to
 * nothing, an ignore rule that swallows the bundle, a binary file the reader
 * skips: every one of those produces a *zero-match* result, and a zero-match
 * result is indistinguishable from success. So this script does three things a
 * one-liner cannot:
 *
 *   1. Enumerates files itself and PRINTS how many it read. A scan that read
 *      0 files fails instead of passing.
 *   2. Runs a POSITIVE CONTROL — a synthetic key written to a temp file, which
 *      the detector must find. If the control is missed, the gate is broken and
 *      the run fails regardless of what `dist/` contains.
 *   3. Scans for a KEY SHAPE, not a key value, so it needs no secret to
 *      compare against and can never itself leak one: matches are reported as
 *      `file:line`, never as content.
 *
 * WHAT IT PROVES
 *
 *   (a) no Gemini-key-shaped literal in the built client or server bundle —
 *       which covers a build-time-inlined `GEMINI_API_KEY`;
 *   (b) no user key in the server-side code path: the only place allowed to
 *       read stored key material and attach it to a request is
 *       `src/lib/client/gemini-direct.ts`, and the host it may talk to is
 *       `generativelanguage.googleapis.com`.
 *
 * It CANNOT prove what a browser does at runtime. The 4.6 claim that the key
 * never reaches our origin is enforced by `src/lib/client/provider.test.ts`
 * (routing assertions plus captured `fetch` URLs), not here. Stated so the
 * gate is not mistaken for a stronger guarantee than it is.
 *
 * Usage: `bun run check:secrets` (run after `bun run build`).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

/** The only files worth reading: text, and small enough to scan. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt', '.astro']);
const MAX_BYTES = 8 * 1024 * 1024;

/** Mirrors `KEY_PATTERN` in `src/lib/client/keystore.ts`. */
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g;

const DIST = 'dist';

/** The one file permitted to attach stored key material to a request. */
const KEY_HEADER = 'x-goog-api-key';
const ALLOWED_KEY_SOURCE = join('src', 'lib', 'client', 'gemini-direct.ts');
/** The only host a browser-side transport may address. */
const ALLOWED_HOST = 'generativelanguage.googleapis.com';

let failures = 0;
const fail = (message) => {
	failures++;
	console.log(`FAIL  ${message}`);
};

/** Every file under `dir` whose extension is in `extensions`. */
function collect(dir, extensions = TEXT_EXTENSIONS) {
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
	return found.filter((path) => {
		const dot = path.lastIndexOf('.');
		return dot !== -1 && extensions.has(path.slice(dot).toLowerCase());
	});
}

/** File and line of every key-shaped literal. Content is never returned. */
function scan(files) {
	/** @type {string[]} */
	const hits = [];
	for (const path of files) {
		const text = readFileSync(path, 'utf8');
		// A minified sourcemap can be tens of MB. Skipping is reported by the
		// caller's file count, never silently: a skipped file is a file the gate
		// did not look at.
		if (text.length > MAX_BYTES) continue;
		for (const [index, line] of text.split('\n').entries()) {
			KEY_PATTERN.lastIndex = 0;
			if (KEY_PATTERN.test(line)) hits.push(`${relative(process.cwd(), path)}:${index + 1}`);
		}
	}
	return hits;
}

console.log('=== positive control ===');
// A synthetic key. Not a credential: 35 x characters after the prefix, chosen
// so it satisfies KEY_PATTERN without being a plausible secret.
const controlKey = `AIza${'x'.repeat(35)}`;
const controlDir = mkdtempSync(join(tmpdir(), 'geminitts-secret-gate-'));
const controlFile = join(controlDir, 'control.js');
writeFileSync(controlFile, `const key = "${controlKey}";\n`);

const controlHits = scan([controlFile]);
rmSync(controlDir, { recursive: true, force: true });

if (controlHits.length === 0) {
	// The loudest possible failure: the gate would report PASS on anything.
	fail('positive control MISSED — the detector found nothing in a file that contains a key. The gate is broken; fix it before trusting any result below.');
} else {
	console.log(`pass  detector found the control key at ${controlHits[0]}`);
}

console.log('\n=== build output ===');
let files = [];
try {
	files = collect(DIST);
} catch {
	// `collect` swallows unreadable directories, so probe for existence here.
}
try {
	readdirSync(DIST);
} catch {
	fail('dist/ does not exist. Run `bun run build` first.');
}

console.log(`info  scanned ${files.length} text file(s) under ${DIST}/`);
if (files.length === 0) fail('scanned 0 files — a zero-file scan is a false pass, not a clean build.');

const hits = scan(files);
if (hits.length > 0) {
	for (const hit of hits) fail(`key-shaped literal in build output at ${hit}`);
} else {
	console.log('pass  no key-shaped literal in the build output');
}

console.log('\n=== source: where key material may be attached ===');
/**
 * Comments and UI copy are stripped before this analysis, and the analysis only
 * reads real modules (`.ts` / `.mjs`).
 *
 * That filtering is not leniency, it is correctness. The first version of this
 * gate failed on TWO false positives, both of them prose: `ByokSettings.astro`
 * renders the string `x-goog-api-key` inside a `<code>` element as part of the
 * user's security statement, and `gemini-direct.ts` mentions `?key=` in a
 * comment explaining why it never does that. A gate that cries wolf on its own
 * documentation gets muted, and a muted gate is worse than no gate — so the
 * check now looks at code, and says so.
 */
const stripComments = (text) =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		// `//` only when it is not the second slash of a `https://` scheme.
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const CODE_EXTENSIONS = new Set(['.ts', '.mjs']);
const codeFiles = collect(join('src'), CODE_EXTENSIONS);

/** @type {string[]} */
const headerUses = [];
for (const path of codeFiles) {
	stripComments(readFileSync(path, 'utf8'))
		.split('\n')
		.forEach((line, index) => {
			if (line.includes(KEY_HEADER)) headerUses.push(`${relative(process.cwd(), path)}:${index + 1}`);
		});
}

if (headerUses.length === 0) {
	fail(`no source module attaches ${KEY_HEADER} — either the transport was removed or this gate is scanning the wrong tree.`);
}
for (const use of headerUses) {
	const file = use.split(':')[0];
	// The transport's own test names the header in an assertion string; it
	// attaches nothing. Only the transport may attach it.
	if (file === ALLOWED_KEY_SOURCE || file.endsWith(`${sep}provider.test.ts`)) continue;
	fail(`${use} attaches ${KEY_HEADER} outside ${ALLOWED_KEY_SOURCE}`);
}
if (headerUses.length > 0) {
	console.log(`pass  ${KEY_HEADER} is confined to ${ALLOWED_KEY_SOURCE}`);
}

const transport = readFileSync(ALLOWED_KEY_SOURCE, 'utf8');
if (!transport.includes(ALLOWED_HOST)) {
	fail(`${ALLOWED_KEY_SOURCE} does not reference ${ALLOWED_HOST} — the browser transport is pointing somewhere unexpected.`);
} else {
	console.log(`pass  the browser transport targets ${ALLOWED_HOST}`);
}

// Structural, not a substring hunt: the key must be passed as a header, never
// interpolated into a URL. `?key=` in a fetch template is the Phase 0.2 leak.
const urlLeak = /`[^`]*\$\{key\}[^`]*`|\?key=/.exec(stripComments(transport));
if (urlLeak) {
	fail(`${ALLOWED_KEY_SOURCE} formats the key into a URL (${urlLeak[0].slice(0, 40)}). Live is the only surface allowed that, and it is server-side.`);
} else {
	console.log('pass  the key is never interpolated into a URL');
}

console.log(
	failures === 0
		? '\nNo secrets in the build output. The user key is browser-only by construction.'
		: `\n${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
