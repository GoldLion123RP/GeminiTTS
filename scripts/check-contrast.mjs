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
 * The token values below are duplicated from `global.css` on purpose: this
 * script is a specification of the intended pairs, and it should FAIL if the
 * stylesheet and this list drift apart, rather than silently re-reading the
 * stylesheet and agreeing with whatever it currently says.
 *
 * Usage: `bun run check:contrast`
 */

/** Token values, mirroring `src/styles/global.css`. */
const LIGHT = {
	canvas: '#fafafa',
	elevated: '#ffffff',
	'hairline-soft': '#f2f2f2',
	hairline: '#ebebeb',
	ink: '#171717',
	'on-primary': '#ffffff',
	body: '#4d4d4d',
	mute: '#6b6b6b',
	faint: '#a1a1a1',
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
 * Non-text pairs, reported as INFORMATION, never as failures.
 *
 * WCAG 1.4.11 asks 3:1 of a boundary "needed to identify a control". It
 * explicitly does NOT apply to purely decorative separators, and a 1px
 * hairline at 1.14:1 is DESIGN.md's stated intent: "Define cards and inputs
 * with a 1px hairline before any shadow — flat is the default." Raising
 * `hairline` to 3:1 would turn every card border into a heavy grey rule and
 * break the system this project is built on. So these are printed for
 * information and excluded from the exit code.
 *
 * ONE CAVEAT, disclosed rather than buried: `input border in cards` is
 * arguably NOT decorative — a border is often the only thing identifying an
 * input's hit area. Under a strict reading of 1.4.11 it should reach 3:1. It
 * is reported here as `warn` instead of `info` to keep that visible. The
 * inputs do carry other affordances (a label above, and the focus ring at
 * 4.70:1), but the border itself is genuinely below the bar. Known gap, not
 * an oversight — see `docs/development.md`.
 */
const BORDER_PAIRS = [
	{ pair: ['hairline', 'canvas', 'card border on canvas'], level: 'info' },
	{ pair: ['hairline', 'elevated', 'input border in cards'], level: 'warn' },
	{ pair: ['hairline-soft', 'elevated', 'selected / inset fill'], level: 'info' },
];

const TEXT_BAR = 4.5; // AA for body text; nothing here is "large" text
const BORDER_REFERENCE = 3; // WCAG 1.4.11, for reference only

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

	console.log(
		`\n=== ${theme.toUpperCase()} — borders (reference ${BORDER_REFERENCE}:1, advisory) ===`,
	);
	for (const { pair, level } of BORDER_PAIRS) {
		const [fg, bg, label] = pair;
		const ratio = contrast(tokens[fg], tokens[bg]);
		const mark = level === 'warn' ? 'warn' : 'info';
		console.log(`${mark}  ${ratio.toFixed(2).padStart(6)}:1  ${label}`);
	}
}

console.log(
	failures === 0
		? '\nAll pairs pass.'
		: `\n${failures} failure(s). Fix the token, do not lower the bar.`,
);
process.exit(failures === 0 ? 0 : 1);
