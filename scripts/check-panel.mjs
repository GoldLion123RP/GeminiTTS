#!/usr/bin/env node
/**
 * Cost-gate gate (the "Generate stays disabled" defect).
 *
 * THE BUG THIS EXISTS TO KEEP FIXED
 *
 * The TTS panel only enables Generate once an estimate exists for the exact
 * text in the box. The estimate is computed in the browser, so it cannot fail
 * for network reasons — it can only fail if the `input` listener was never
 * attached, or was attached after the text had already arrived. Three ordinary
 * browser behaviours put text in a textarea without firing `input`: form
 * restoration on reload and back/forward, a paste that lands before the module
 * executes, and some mobile clipboard and autofill paths.
 *
 * The result was a page showing a full paragraph of text, an empty cost, a
 * disabled button, and a note reading "An estimate must load before
 * generating" — with nothing the user could do about it. No unit test caught
 * it, because the panel is a DOM script and there was no DOM in the test
 * suite. `check:shell` could not catch it either: it reads source, and the
 * source was correct.
 *
 * WHAT IT CHECKS
 *
 * Two gates, because "the page works" covers more than one failure mode:
 *
 *   1. The SHIPPED bundle from `dist/client/_astro/` is run against a small DOM
 *      stub — the artifact the browser will actually download, not the source
 *      that produced it — and the cost gate must open in two scenarios:
 *        a. text is typed after load (the obvious path);
 *        b. text is ALREADY in the box when the module runs (the regression).
 *        c. POSITIVE CONTROL: a bundle built from a panel with the
 *           reconciliation removed must FAIL scenario b. A check that cannot
 *           fail is not a check, and this one was written against a bug that
 *           shipped, so it has to be shown failing at least once.
 *
 *   2. `check:spacing.mjs`, spawned below: every declared stack of sibling
 *      panels carries a non-zero vertical gap. Read-only against the built
 *      HTML, and carrying its own positive control.
 *
 *
 * Usage: `bun run check:panel` (run after `bun run build`).
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO_DIR = join(ROOT, 'dist', 'client', '_astro');

let failures = 0;
const fail = (message) => {
	failures++;
	console.log(`FAIL  ${message}`);
};
const pass = (message) => console.log(`pass  ${message}`);

function findPanelChunk() {
	if (!existsSync(ASTRO_DIR)) {
		fail('dist/client/_astro is missing — run `bun run build` first.');
		return null;
	}
	const name = readdirSync(ASTRO_DIR).find((file) => /^TtsPanel\..*\.js$/.test(file));
	if (!name) {
		fail('no TtsPanel chunk in dist/client/_astro — the panel was not built, or was renamed.');
		return null;
	}
	return join(ASTRO_DIR, name);
}

/** The DOM stub, as a module the bundle can be imported against. */
function writeHarness(dir) {
	const path = join(dir, 'harness.mjs');
	writeFileSync(
		path,
		`
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = process.env.BUNDLE_PATH;
const PRELOAD = process.env.PRELOAD === '1';
const TEXT = 'আমাদের গ্লাসের বাড়িতে ছোট মামার বিশেষ সিদ্ধান্ত নিয়েছিলাম।';

class ClassList {
	constructor() { this.set = new Set(); }
	add(n) { this.set.add(n); }
	remove(n) { this.set.delete(n); }
	toggle(n, force) { if (force) this.set.add(n); else this.set.delete(n); }
	contains(n) { return this.set.has(n); }
}

class El {
	// parentElement is lazy: constructing one eagerly recursed forever.
	constructor(id) {
		this.id = id; this.value = ''; this.textContent = ''; this.disabled = false;
		this.checked = false; this.classList = new ClassList(); this.listeners = {};
		this.parentElement = null; this.files = [];
	}
	addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
	removeEventListener() {}
	setAttribute() {}
	getAttribute() { return null; }
	appendChild() {}
	cloneNode() { return new El(this.id + '-clone'); }
	querySelector() { return new El('inner'); }
	querySelectorAll() { return []; }
	get firstElementChild() { return new El('child'); }
	focus() {}
	click() {}
}

const registry = new Map();
// documentElement exists in every browser and carries the readiness flag the
// panel sets and the watchdog reads. A stub without it turns a real browser
// guarantee into a TypeError — and that is how this harness caught the first
// draft of the watchdog, which is the point of running the artifact at all.
const documentElement = { dataset: {} };
globalThis.document = {
	documentElement,
	getElementById(id) { if (!registry.has(id)) registry.set(id, new El(id)); return registry.get(id); },
	querySelector: () => new El('q'),
	querySelectorAll: () => [],
	createElement: (tag) => new El('created-' + tag),
	addEventListener() {},
	body: new El('body'),
};
globalThis.window = {
	addEventListener() {},
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (t) => clearTimeout(t),
};
globalThis.localStorage = new El('local');
globalThis.sessionStorage = new El('session');
// Node 22 exposes \`navigator\` as a getter-only global, so a plain assignment
// throws and takes the whole harness down with it.
Object.defineProperty(globalThis, 'navigator', {
	value: { mediaDevices: { getUserMedia: async () => ({}) } },
	configurable: true,
	writable: true,
});
globalThis.AudioContext = class {};
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};

// Must exist before the module reads it, or the module would be the thing that
// creates it and the preload would land on a different object.
if (PRELOAD) {
	document.getElementById('tts-text').value = TEXT;
}
// NO_MODULE simulates the real failure: a cached HTML page referencing a chunk
// the current deployment no longer has. The module never executes, so no
// listener is attached — and that is the state the watchdog exists for.
if (process.env.NO_MODULE !== '1') await import(BUNDLE);

// getElementById, not registry.get: in the NO_MODULE run nothing has touched
// the registry yet, and the stub creates on demand.
const textarea = document.getElementById('tts-text');
if (!PRELOAD) {
	textarea.value = TEXT;
	for (const fn of textarea.listeners.input ?? []) fn();
}
await new Promise((r) => setTimeout(r, 600));

// The watchdog is a CLASSIC inline script in the page, not part of the module,
// so the harness has to run it the way a browser would: separately, with the
// module's readiness flag unset — which is exactly the state a user is in when
// the chunk 404s.
let inline = null;
try {
	const html = readFileSync(join(process.env.PAGE_HTML, 'index.html'), 'utf8');
	inline = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)]
		.map((m) => m[1])
		.find((body) => body.includes('ttsPanel') && body.includes('setTimeout'));
} catch {
	// No prerendered page on disk: this is a NODE build, where the HTML is
	// rendered on demand. The module assertions still run; the watchdog is
	// asserted in CI, whose job builds the static target.
}
if (inline) {
	// Running the page's own script IS the test: a stub of it would only prove
	// the stub works.
	const watchdog = new Function('document', 'window', 'URL', 'Date', inline);
	watchdog(document, window, URL, Date);
	await new Promise((r) => setTimeout(r, 3200));
}

console.log(JSON.stringify({
	disabled: document.getElementById('tts-confirm').disabled,
	cost: document.getElementById('tts-est-cost').textContent,
	note: document.getElementById('tts-gate-note').textContent,
	watchdogAlertShown: !document.getElementById('tts-alert').classList.contains('hidden'),
	watchdogTitle: document.getElementById('tts-alert-title').textContent,
	watchdogRetry: document.getElementById('tts-alert-retry').textContent,
	watchdogTested: Boolean(inline),
}));
`,
	);
	return path;
}

function run(harness, chunkPath, preload, noModule = false) {
	const result = spawnSync(process.execPath, [harness], {
		cwd: ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			BUNDLE_PATH: pathToFileURL(chunkPath).href,
			PAGE_HTML: join(ROOT, 'dist', 'client', 'text-to-speech'),
			NO_MODULE: noModule ? '1' : '0',
			PRELOAD: preload ? '1' : '0',
		},
	});
	if (result.status !== 0) {
		fail(`the panel threw under the stub — ${relative(ROOT, chunkPath)}:\n${result.stderr.trim()}`);
		return null;
	}
	try {
		return JSON.parse(result.stdout.trim().split('\n').pop());
	} catch {
		fail(`unreadable harness output from ${relative(ROOT, chunkPath)}: ${result.stdout.trim()}`);
		return null;
	}
}

const dir = mkdtempSync(join(tmpdir(), 'geminitts-panel-gate-'));

/**
 * The layout gate, run from here so one command covers "does the page work".
 *
 * `check-spacing.mjs` is a separate script with its own `package.json` entry and
 * its own controls; it is only *invoked* from here so that `bun run check:panel`
 * does not report green on a page whose panels are welded together. It is
 * spawned, not imported, for the same reason this file spawns its harness: its
 * exit code is the contract, and a child process cannot leak a partial state
 * into the DOM harness below.
 *
 * Read-only, so running it first is safe: the positive control further down
 * rebuilds the project, and anything asserted against the artifact has to
 * happen before that.
 */
console.log('=== vertical rhythm (check:spacing) ===');
const spacing = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-spacing.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});
process.stdout.write(spacing.stdout ?? '');
if (spacing.status !== 0) {
  process.stderr.write(spacing.stderr ?? '');
  fail('`check:spacing` failed — the stacked panels on a tool page are touching. See the output above.');
}
console.log('');

try {
	const chunk = findPanelChunk();
	if (chunk) {
		const harness = writeHarness(dir);
		console.log(`=== the shipped bundle (${relative(ROOT, chunk)}) ===`);

		const typed = run(harness, chunk, false);
		if (typed) {
			if (typed.disabled) fail('Generate is still disabled after typing text.');
			else if (typed.cost === '') fail('no cost was rendered after typing text.');
			else pass(`typing opens the gate (cost ${typed.cost})`);
			// The watchdog must STAY OUT OF THE WAY when the panel works. A
			// watchdog that fires on a healthy page is worse than none: it would
			// tell every user their page is broken.
			if (typed.watchdogAlertShown && typed.watchdogTested) {
				fail(`the watchdog raised an alert on a working page — it must only fire when the panel did not start. Title: ${typed.watchdogTitle}`);
			} else {
				pass('the watchdog stays silent on a working page');
			}
		}

		// THE SILENT FAILURE. A cached page pointing at a chunk this deployment
		// no longer has: the module 404s, nothing is attached, and the user sees
		// a dead button and an unrelated note. The watchdog is the only thing on
		// the page that can still speak, because it is a classic script.
		const broken = run(harness, chunk, false, true);
		if (broken && !broken.watchdogTested) {
			console.log('skip  watchdog not testable on a node build (no prerendered page); CI builds the static target and asserts it');
		} else if (broken) {
			if (!broken.watchdogAlertShown) {
				fail(
					'the watchdog stayed silent when the panel module never loaded. The page would ' +
						'again show a dead Generate button and "an estimate must load" with no ' +
						'explanation — the silent failure this exists to prevent.',
				);
			} else if (!/reload/i.test(broken.watchdogTitle + broken.watchdogRetry)) {
				fail(`the watchdog fired but offered no action. Title: ${broken.watchdogTitle} / ${broken.watchdogRetry}`);
			} else {
				pass(`a panel that fails to load is reported, with a reload (${broken.watchdogTitle})`);
			}
		}

		// The regression: text present, no `input` event.
		const restored = run(harness, chunk, true);
		if (restored) {
			if (restored.disabled) {
				fail(
					`Generate is disabled when the textarea already has text on load. ` +
						`The panel never reconciles text that arrived without an \`input\` event ` +
						`(form restore, early paste, autofill). Note reads: ${restored.note}`,
				);
			} else {
				pass(`a restored textarea opens the gate (cost ${restored.cost})`);
			}
		}

		console.log('\n=== positive control ===');
		// The control is a REAL build of a panel with the reconciliation removed
		// — the pre-fix shape. It mutates the working tree, so the original is
		// restored in `finally` and the real build is re-run afterwards; a check
		// that leaves the repo in a modified state, or whose artifact no longer
		// matches the source, is worse than no check.
		//
		// D12. The four removals are `\n`-anchored, and this repository is
		// checked out CRLF (`core.autocrlf` is true), so against the raw file
		// `\n\t}\n` cannot match `\n\r\n\t}\r\n`. Three of the four silently
		// removed nothing, the control still called `resyncEstimate()` on load,
		// the gate opened, and this check reported the honest and useless
		// "positive control MISSED". The `stripped === original` guard did not
		// catch it, because the ONE removal that used a bare `\n` inside its
		// line did match — so the file differed while the control was still the
		// post-fix shape. Hence two changes, and both are load-bearing:
		//
		//   1. strip in a normalised LF copy, and write the control back with the
		//      file's own line endings, so the round trip is byte-identical;
		//   2. assert that EVERY removal removed something, by label — not merely
		//      that the file changed. A partial control is a control that tests
		//      nothing while looking like it tested something.
		const panelPath = join(ROOT, 'src', 'components', 'TtsPanel.astro');
		const onDisk = readFileSync(panelPath, 'utf8');
		const eol = onDisk.includes('\r\n') ? '\r\n' : '\n';
		const original = onDisk.replace(/\r\n/g, '\n');

		/** [label, pattern, replacement] — labelled so a miss names itself. */
		const REMOVALS = [
			['the resyncEstimate function', /function resyncEstimate\(\)[\s\S]*?\n\t}\n/, ''],
			['the paste listener', /textarea\.addEventListener\('paste'[\s\S]*?\n/, ''],
			['the change listener', /textarea\.addEventListener\('change', resyncEstimate\);\n/, ''],
			['the on-load resyncEstimate() call', /\n\t\/\/ The restore case above[\s\S]*?\n\tresyncEstimate\(\);\n/, '\n'],
		];

		/** @type {string[]} */
		const missed = [];
		let stripped = original;
		for (const [label, pattern, replacement] of REMOVALS) {
			const next = stripped.replace(pattern, replacement);
			if (next === stripped) missed.push(label);
			stripped = next;
		}

		if (missed.length > 0) {
			fail(
				`positive control could not be built — these removals found nothing in ` +
					`TtsPanel.astro: ${missed.join('; ')}. A partial control is not a control: ` +
					'if the panel was renamed or reformatted, update the patterns here.',
			);
		} else {
			try {
				writeFileSync(panelPath, stripped.replace(/\n/g, eol));
				const controlBuild = spawnSync('bun', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
				const controlChunk = controlBuild.status === 0 ? findPanelChunk() : null;
				if (!controlChunk) {
					fail(`positive control build failed:\n${controlBuild.stderr.trim()}`);
				} else {
					const control = run(harness, controlChunk, true);
					if (!control) {
						fail('positive control could not be evaluated.');
					} else if (!control.disabled) {
						fail(
							'positive control MISSED — the gate opened on a panel with the reconciliation ' +
								'removed. This check cannot fail, so it proves nothing.',
						);
					} else {
						pass('the gate fails on a panel with the reconciliation removed (the control is real)');
					}
				}
			} finally {
				// `onDisk`, not `original`: this file is checked out CRLF, and
				// restoring the LF-normalised copy would silently rewrite all 750
				// line endings — a working-tree mutation this check makes on
				// every run, in a file it does not own.
				writeFileSync(panelPath, onDisk);
				// Rebuild so `dist/` matches the real source again. A gate that
				// leaves a stale artifact behind would poison the next check: it
				// would test the control instead of the code.
				spawnSync('bun', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
			}
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(`\n${failures} failure(s). The cost gate is not trustworthy.`);
	process.exit(1);
}
console.log('\nCost gate holds. Generate opens for typed and for restored text.');
