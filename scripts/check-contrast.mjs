#!/usr/bin/env bun
/**
 * WCAG 2.1 contrast audit for the design tokens in `src/styles/global.css`.
 *
 * WHY THIS EXISTS
 *
 * A dark ramp is a perceptual judgement, but *contrast ratio is arithmetic* —
 * and the arithmetic is where dark ramps actually fail. The light theme's
 * original `mute` (#8f8f8f), `faint` (#a1a1a1) and `link` (#0070f3) all looked
 * correct and all failed AA: 3.10:1, 2.58:1 and 4.36:1 against the near-white
 * canvas. No amount of squinting would have caught that; computing it did.
 *
 * Re-run this after ANY change to a colour token. Both themes are checked, and
 * the light theme is checked on purpose — Phase 2 found its failures while
 * building the dark one.
 *
 * The same arithmetic caught the border defect. `hairline` was 1.14:1 on the
 * canvas and the script printed that on every run, at `info`, and exited 0.
 * Borders are now held to SC 1.4.11 and counted as failures. Any pair that is
 * measured but deliberately not counted lives in `BORDER_EXCLUSIONS` with the
 * reason attached, so the exit code and the reasoning cannot drift apart.
 *
 * The duplicated values above are a SPECIFICATION, not a cache — and a
 * specification is only worth anything if the real stylesheet is checked
 * against it. `DRIFT` below does that: it parses `global.css` and fails when
 * either list here disagrees with it. Without it the header's claim that this
 * script "should FAIL if the stylesheet and this list drift apart" was
 * aspirational — the previous version duplicated the tokens and never read the
 * file, so moving `hairline` back to #ebebeb in the stylesheet left this script
 * cheerfully green. A gate that cannot fail is not a gate.
 *
 * The token values below are duplicated from `global.css` on purpose: this
 * script is a specification of the intended pairs, and it should FAIL if the
 * stylesheet and this list drift apart, rather than silently re-reading the
 * stylesheet and agreeing with whatever it currently says. The `DRIFT` section
 * below is what makes that claim true — it is a *check*, not a re-read.
 *
 * Usage: `bun run check:contrast`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STYLESHEET = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'src',
	'styles',
	'global.css',
);

/** Token values, mirroring `src/styles/global.css`. */
const LIGHT = {
	canvas: '#fafafa',
	elevated: '#ffffff',
	'hairline-soft': '#f2f2f2',
	hairline: '#8c8c8c',
	ink: '#171717',
	'on-primary': '#ffffff',
	body: '#4d4d4d',
	mute: '#6b6b6b',
	faint: '#727272',
	link: '#006ce5',
	'link-deep': '#0761d1',
	error: '#ee0000',
	'warning-deep': '#ab570a',
	violet: '#7928ca',
};

const DARK = {
	canvas: '#0a0a0a',
	elevated: '#141414',
	'hairline-soft': '#1a1a1a',
	hairline: '#262626',
	ink: '#ededed',
	'on-primary': '#0a0a0a',
	body: '#b0b0b0',
	mute: '#949494',
	faint: '#8a8a8a',
	link: '#5aa9ff',
	'link-deep': '#8cc4ff',
	error: '#ff7b7b',
	'warning-deep': '#f5c67f',
	violet: '#c39bff',
};

/**
 * [foreground, background, label] triples that actually occur in the markup.
 * Derived by grepping the Astro sources for the token utilities, so a pair is
 * only listed because two elements are genuinely paired in the tree.
 */
const TEXT_PAIRS = [
	['ink', 'canvas', 'headings, wordmark on canvas'],
	['ink', 'elevated', 'headings, input text in cards'],
	['body', 'canvas', 'body copy on canvas'],
	['body', 'elevated', 'body copy in cards'],
	['mute', 'canvas', 'eyebrows, metadata on canvas'],
	['mute', 'elevated', 'eyebrows, metadata in cards'],
	['faint', 'elevated', 'input placeholders'],
	['link', 'canvas', 'links on canvas'],
	['link', 'elevated', 'links in cards'],
	['error', 'elevated', 'error text'],
	['warning-deep', 'elevated', 'warning text'],
	['violet', 'elevated', 'violet accent text'],
	// Primary button is ink fill with on-primary label — a reversed pair.
	['on-primary', 'ink', 'primary button label (reversed)'],
];

/**
 * Non-text pairs, held to WCAG 2.1 SC 1.4.11 and counted as FAILURES.
 *
 * 1.4.11 asks 3:1 of "a visual boundary required to identify a UI component".
 * A card's 1px border identifies the card; a text input's or a `<select>`'s
 * border is frequently the only thing marking the hit area. Neither is
 * decorative, and the earlier version of this script said so in a comment and
 * then excluded them from the exit code anyway — printing `warn` on every run
 * and exiting 0. A gap that is still reported as a pass is a gap that never
 * closes, and that is what it did: light-theme `hairline` sat at 1.14:1 and
 * every card rendered as an unbordered slab.
 *
 * The token was lifted to #8c8c8c (3.22:1 on canvas, 3.36:1 on elevated) and
 * the light theme's pairs are now enforcing. DESIGN.md's rule — "Define cards
 * and inputs with a 1px hairline before any shadow" — is about *shape and
 * priority*, not about lightness, and a value change keeps both. The token's
 * name, role and every consumer are untouched. The alternative, keeping #ebebeb
 * and adding a shadow to every card, would have inverted the system's own
 * stated priority and is the thing DESIGN.md's Don'ts list names.
 *
 * Keyed by theme, because the dark theme's own hairline is not yet at the bar
 * and Phase 2 was scoped to the light one. A theme with no enforcing pair
 * prints an explicit `none` rather than nothing at all, so an empty list can
 * never be mistaken for a theme that was simply not checked.
 *
 * `hairline-soft` is NOT listed in either theme. It is a fill — a selected/inset
 * well, not a boundary — and 1.4.11 explicitly does not apply to it. It is
 * reported as an exclusion so its absence is a decision on the record rather
 * than an oversight.
 */
const BORDER_PAIRS = {
	light: [
		['hairline', 'canvas', 'card border on canvas'],
		['hairline', 'elevated', 'input border in cards'],
	],
	dark: [],
};

/**
 * Border pairs that are measured and printed but NOT counted, each with the
 * reason it is not counted. An exclusion without a stated reason is an
 * undischarged rationale, so the reason is part of the entry.
 *
 * `dark` hairline is #262626, DESIGN.md's own value, and measures 1.22:1 in
 * cards and 1.31:1 on canvas. It is genuinely below 1.4.11 in both themes'
 * terms; what differs is that a 1px step on a near-black field reads as a
 * visible edge where the same ratio on near-white does not. That is a
 * perceptual argument, not an accessibility one, so it is recorded as a
 * deferred gap (`docs/development.md`, "Known gaps") rather than argued away
 * here. Phase 2 scoped itself to the light theme, which is where the defect
 * was reported; changing the dark value is a separate decision with its own
 * visual review.
 */
const BORDER_EXCLUSIONS = {
	light: [
		{
			pair: ['hairline-soft', 'elevated', 'selected / inset fill'],
			reason: 'a fill, not a boundary — SC 1.4.11 does not apply',
		},
	],
	dark: [
		{
			pair: ['hairline', 'elevated', 'input border in cards'],
			reason: 'below 3:1 and not fixed here — recorded gap, see docs/development.md',
		},
		{
			pair: ['hairline', 'canvas', 'card border on canvas'],
			reason: 'below 3:1 and not fixed here — recorded gap, see docs/development.md',
		},
		{
			pair: ['hairline-soft', 'elevated', 'selected / inset fill'],
			reason: 'a fill, not a boundary — SC 1.4.11 does not apply',
		},
	],
};

const TEXT_BAR = 4.5; // AA for body text; nothing here is "large" text
const BORDER_REFERENCE = 3; // WCAG 1.4.11 — now enforced, not advisory

const hexToRgb = (hex) => {
	const s = hex.replace('#', '');
	const f = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
	return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};

const channel = (c) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
	const [r, g, b] = hexToRgb(hex).map(channel);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

let failures = 0;

/* --- DRIFT: the lists above are checked against the real stylesheet ------- */

/** The declarations inside one block, keyed by token name. */
const declarations = (css) => {
	const found = {};
	for (const [, name, value] of css.matchAll(
		/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g,
	)) {
		found[name] = value;
	}
	return found;
};

/**
 * Slice out one balanced `{ … }` block starting at `open`, brace-counted so a
 * nested rule or a later `[data-theme='dark'] .selector` cannot be swallowed.
 * Returns null when the selector is absent — a renamed block must fail loudly
 * below, not silently yield an empty token set that trivially "agrees".
 */
const block = (css, open) => {
	const start = css.indexOf(open);
	if (start === -1) return null;
	const from = css.indexOf('{', start);
	if (from === -1) return null;
	let depth = 0;
	for (let i = from; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) return css.slice(from + 1, i);
	}
	return null;
};

// Comments first: a hex inside a rationale comment is prose, not a token.
const stylesheet = readFileSync(STYLESHEET, 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	'',
);

const themeBlock = block(stylesheet, "[data-theme='dark']");
const actual = {
	light: declarations(themeBlock ? stylesheet.slice(0, stylesheet.indexOf("[data-theme='dark']")) : ''),
	dark: declarations(themeBlock ?? ''),
};

console.log('=== DRIFT — this script vs src/styles/global.css ===');
for (const [theme, listed] of /** @type {const} */ ([
	['light', LIGHT],
	['dark', DARK],
])) {
	if (actual[theme] === null || Object.keys(actual[theme] ?? {}).length === 0) {
		failures++;
		console.log(
			`FAIL  ${theme}: no ${theme === 'light' ? '@theme' : "[data-theme='dark']"} block found in global.css`,
		);
		continue;
	}
	for (const [token, value] of Object.entries(listed)) {
		const found = actual[theme][token];
		const ok = found?.toLowerCase() === value.toLowerCase();
		if (!ok) failures++;
		console.log(
			`${ok ? 'pass' : 'FAIL'}  ${theme}.${token.padEnd(14)} ${(found ?? 'ABSENT').padEnd(9)} (listed ${value})`,
		);
	}
	// A token the stylesheet declares under a name this script does not audit is
	// a pair nobody is checking. Counted and named, rather than left to pass
	// unseen — but collapsed to one line per theme, because twenty identical
	// lines on every run is how a real failure stops being read.
	const unaudited = Object.keys(actual[theme]).filter((t) => !(t in listed));
	if (unaudited.length > 0) {
		console.log(
			`skip  ${theme}: ${unaudited.length} declared token(s) not audited here — ${unaudited.join(', ')}`,
		);
	}
}

for (const [theme, tokens] of /** @type {const} */ ([
	['light', LIGHT],
	['dark', DARK],
])) {
	console.log(`\n=== ${theme.toUpperCase()} — text (bar ${TEXT_BAR}:1) ===`);
	for (const [fg, bg, label] of TEXT_PAIRS) {
		const ratio = contrast(tokens[fg], tokens[bg]);
		const ok = ratio >= TEXT_BAR;
		if (!ok) failures++;
		console.log(
			`${ok ? 'pass' : 'FAIL'}  ${ratio.toFixed(2).padStart(6)}:1  ${label}`,
		);
	}

	console.log(`\n=== ${theme.toUpperCase()} — borders (bar ${BORDER_REFERENCE}:1, SC 1.4.11) ===`);
	for (const [fg, bg, label] of BORDER_PAIRS[theme]) {
		const ratio = contrast(tokens[fg], tokens[bg]);
		const ok = ratio >= BORDER_REFERENCE;
		if (!ok) failures++;
		console.log(
			`${ok ? 'pass' : 'FAIL'}  ${ratio.toFixed(2).padStart(6)}:1  ${label}`,
		);
	}
	if (BORDER_PAIRS[theme].length === 0) {
		console.log('none  no border pair is enforcing in this theme — see BORDER_EXCLUSIONS');
	}
	for (const { pair, reason } of BORDER_EXCLUSIONS[theme]) {
		const [fg, bg, label] = pair;
		const ratio = contrast(tokens[fg], tokens[bg]);
		console.log(`skip  ${ratio.toFixed(2).padStart(6)}:1  ${label} — ${reason}`);
	}
}

console.log(
	failures === 0
		? '\nAll pairs pass.'
		: `\n${failures} failure(s). Fix the token, do not lower the bar.`,
);
process.exit(failures === 0 ? 0 : 1);
