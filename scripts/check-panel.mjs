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
 * It runs the SHIPPED bundle from `dist/client/_astro/` against a small DOM
 * stub — the artifact the browser will actually download, not the source that
 * produced it — and asserts the gate opens in two scenarios:
 *
 *   1. text is typed after load (the obvious path);
 *   2. text is ALREADY in the box when the module runs (the regression).
 *
 *   3. POSITIVE CONTROL: a bundle built from a panel with the reconciliation
 *      removed must FAIL scenario 2. A check that cannot fail is not a check,
 *      and this one was written against a bug that shipped, so it has to be
 *      shown failing at least once.
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
globalThis.document = {
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
await import(BUNDLE);

const textarea = registry.get('tts-text');
if (!PRELOAD) {
	textarea.value = TEXT;
	for (const fn of textarea.listeners.input ?? []) fn();
}
await new Promise((r) => setTimeout(r, 600));

console.log(JSON.stringify({
	disabled: registry.get('tts-confirm').disabled,
	cost: registry.get('tts-est-cost').textContent,
	note: registry.get('tts-gate-note').textContent,
}));
`,
	);
	return path;
}

function run(harness, chunkPath, preload) {
	const result = spawnSync(process.execPath, [harness], {
		cwd: ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			BUNDLE_PATH: pathToFileURL(chunkPath).href,
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
		const panelPath = join(ROOT, 'src', 'components', 'TtsPanel.astro');
		const original = readFileSync(panelPath, 'utf8');
		const stripped = original
			.replace(/function resyncEstimate\(\)[\s\S]*?\n\t}\n/, '')
			.replace(/textarea\.addEventListener\('paste'[\s\S]*?\n/, '')
			.replace(/textarea\.addEventListener\('change', resyncEstimate\);\n/, '')
			.replace(/\n\t\/\/ The restore case above[\s\S]*?\n\tresyncEstimate\(\);\n/, '\n');

		if (stripped === original) {
			fail(
				'positive control could not be built — the reconciliation code was not found in ' +
					'TtsPanel.astro. If it was renamed, update this check.',
			);
		} else {
			try {
				writeFileSync(panelPath, stripped);
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
				writeFileSync(panelPath, original);
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
