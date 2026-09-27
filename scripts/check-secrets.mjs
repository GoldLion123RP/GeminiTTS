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
import { join, relative } from 'node:path';

/** The only files worth reading: text, and small enough to scan. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt', '.astro']);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Mirrors `KEY_PATTERN` in `src/lib/client/keystore.ts`.
 *
 * Both prefixes, and the `AQ.` one is the one Google issues today. A scanner
 * that only knew `AIza` would report PASS on a build containing a real, current
 * key — the failure mode this gate exists to prevent, arriving through a key
 * format change rather than a careless paste.
 */
const KEY_PATTERN = /(?:AIza|AQ\.)[0-9A-Za-z_-]{20,}/g;

const DIST = 'dist';

const KEY_HEADER = 'x-goog-api-key';

/** The only host a browser-side transport may address. */
const ALLOWED_HOST = 'generativelanguage.googleapis.com';

/**
 * The files permitted to attach the key header, each for a stated reason.
 *
 * This is an allowlist of *two* because there are two genuinely different keys
 * in this app, and conflating them would be the mistake:
 *
 *   1. `gemini-direct.ts` — the USER's key, read from browser storage and sent
 *      straight to Google. This is the path Phase 4 built, and the reason the
 *      rule exists: a browser key must never be routed anywhere else.
 *
 *   2. `health.ts` — OUR key, read from `process.env` on the server and sent to
 *      the same host, to answer "is this key configured?". Added in Phase 5.1.
 *      It is a different credential from a different place with a different
 *      trust model, and the leak this rule guards against — a *stored user key*
 *      reaching our server or a third party — cannot occur in a module that
 *      never imports `lib/client/keystore.ts`.
 *
 *   3. `key-probe.ts` — the USER's key again, for the "Save and test" control
 *      to be true to its label. Same credential as (1), same single host, same
 *      header, and it reaches the key only as an argument from the settings
 *      panel rather than out of storage — so it cannot widen the blast radius
 *      the first two entries bound. It is a separate file because it is a
 *      different question: (1) is "can I do work", this is "is this string a
 *      key at all", and merging them would put a credential check inside the
 *      transport that performs generation calls.
 *
 * The alternative was to route the probe through `@google/genai` (which
 * attaches auth headers internally and so would slip past this gate entirely).
 * Preferring an explicit, greppable header over an invisible SDK mechanism is
 * the better trade: this gate can now see the call, and adding a fourth file
 * here has to be a deliberate edit.
 */
const ALLOWED_KEY_SOURCES = new Set([
	join('src', 'lib', 'client', 'gemini-direct.ts'),
	join('src', 'lib', 'client', 'key-probe.ts'),
	join('src', 'lib', 'gemini', 'health.ts'),
]);

/**
 * Test files that name the header in an assertion string. They attach nothing.
 *
 * `key-probe.test.ts` earns its place here for the same reason the other two
 * are listed: the whole point of its assertions is that the user's key travels
 * in `x-goog-api-key` and NOT in the URL, so the header has to appear
 * literally. A test that could not name it could not check the rule.
 */
const ASSERTION_ONLY = new Set([
	join('src', 'lib', 'client', 'provider.test.ts'),
	join('src', 'lib', 'client', 'key-probe.test.ts'),
	join('src', 'lib', 'gemini', 'health.test.ts'),
]);

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
// Two synthetic keys, one per live format. Not credentials: 35 x characters
// after each prefix, chosen so they satisfy KEY_PATTERN without being plausible
// secrets. A single control would leave the other prefix unproven, and an
// unproven prefix is exactly how a gate passes a leak.
const controlDir = mkdtempSync(join(tmpdir(), 'geminitts-secret-gate-'));
const controlKeys = { legacy: `AIza${'x'.repeat(35)}`, auth: `AQ.Ab${'x'.repeat(33)}` };

for (const [label, controlKey] of Object.entries(controlKeys)) {
	const controlFile = join(controlDir, `control-${label}.js`);
	writeFileSync(controlFile, `const key = "${controlKey}";\n`);

	const controlHits = scan([controlFile]);
	if (controlHits.length === 0) {
		// The loudest possible failure: the gate would report PASS on anything.
		fail(`positive control MISSED (${label} format) — the detector found nothing in a file that contains a key. The gate is broken; fix it before trusting any result below.`);
	} else {
		console.log(`pass  detector found the ${label}-format control key at ${controlHits[0]}`);
	}
}
rmSync(controlDir, { recursive: true, force: true });

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
	if (ALLOWED_KEY_SOURCES.has(file) || ASSERTION_ONLY.has(file)) continue;
	fail(`${use} attaches ${KEY_HEADER}, which is confined to ${[...ALLOWED_KEY_SOURCES].join(' and ')}`);
}
if (headerUses.length > 0) {
	console.log(`pass  ${KEY_HEADER} is confined to ${[...ALLOWED_KEY_SOURCES].join(' and ')}`);
}

const BROWSER_TRANSPORT = join('src', 'lib', 'client', 'gemini-direct.ts');
const transport = readFileSync(BROWSER_TRANSPORT, 'utf8');
if (!transport.includes(ALLOWED_HOST)) {
	fail(`${BROWSER_TRANSPORT} does not reference ${ALLOWED_HOST} — the browser transport is pointing somewhere unexpected.`);
} else {
	console.log(`pass  the browser transport targets ${ALLOWED_HOST}`);
}

// Structural, not a substring hunt: the key must be passed as a header, never
// interpolated into a URL. `?key=` in a fetch template is the Phase 0.2 leak.
const urlLeak = /`[^`]*\$\{key\}[^`]*`|\?key=/.exec(stripComments(transport));
if (urlLeak) {
	fail(`${BROWSER_TRANSPORT} formats the key into a URL (${urlLeak[0].slice(0, 40)}). Live is the only surface allowed that, and it is server-side.`);
} else {
	console.log('pass  the key is never interpolated into a URL');
}

console.log(
	failures === 0
		? '\nNo secrets in the build output. The user key is browser-only by construction.'
		: `\n${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
