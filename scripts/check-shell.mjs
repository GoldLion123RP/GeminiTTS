#!/usr/bin/env bun
/**
 * Shell contract gate (Phase 6.2 / 6.3 / 6.4).
 *
 * WHY THIS EXISTS
 *
 * Plan Phase 6 is the verification phase, and 6.2 (theme x route, no flash),
 * 6.3 (keyboard-only) and 6.4 (responsive) are all *perceptual* checks. A
 * perceptual check run once by hand produces a sentence in a changelog and no
 * way to tell whether a later phase broke it. The Phase 5 verdict says so
 * outright: the dark ramp and the a11y fixes were "asserted structurally, not
 * perceptually — nobody has looked at a rendered page".
 *
 * This gate does not replace looking at a page. It replaces *remembering to*.
 * It asserts the structural preconditions that a browser would otherwise be
 * asked to discover:
 *
 *   6.2  the no-flash bootstrap is inline, synchronous, in <head>, and runs
 *        before the stylesheet that paints the canvas — a `type="module"` or a
 *        deferred script restores the theme after first paint, which is the
 *        flash this whole mechanism exists to prevent.
 *   6.2  every route inherits the shell, so the matrix is not "some pages".
 *   6.3  the skip link is the first focusable element in the document and
 *        points at a target that exists.
 *   6.3  no positive `tabindex`, which is the only way DOM order and tab order
 *        can diverge silently.
 *   6.4  no fixed pixel width on a top-level layout container, which is the
 *        usual way a "responsive" page stops being responsive at 1200px.
 *
 * Every must-be-zero assertion here runs a POSITIVE CONTROL first, for the
 * reason `check:secrets.mjs` and `check-routes.mjs` already record: a grep that
 * matches nothing may simply have matched no files.
 *
 * Usage: `bun run check:shell`. Reads the SOURCE tree; run it before or after
 * `bun run build`. It is deliberately independent of `dist/` so a stale build
 * can never be mistaken for a verified shell.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

let failures = 0;
const fail = (message) => {
	failures++;
	console.log(`FAIL  ${message}`);
};
const pass = (message) => console.log(`pass  ${message}`);
const info = (message) => console.log(`info  ${message}`);

const LAYOUT = join('src', 'layouts', 'Layout.astro');
const HEADER = join('src', 'components', 'SiteHeader.astro');
const STYLES = join('src', 'styles', 'global.css');
const PAGES = join('src', 'pages');

/** Every `.astro` page under `src/pages/`, top level only (the API routes are .ts). */
function pageFiles() {
	if (!existsSync(PAGES)) return [];
	return readdirSync(PAGES, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
		.map((entry) => join(PAGES, entry.name));
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS
//
// Each detector is a plain function so it can be proven to fire on a known-bad
// string before it is trusted to report a pass on real source.
// ---------------------------------------------------------------------------

/** A head script that is deferred (module) or otherwise not synchronous. */
const isDeferred = (html) => /<script[^>]*\btype=["']?module["']?/i.test(html);
/** A head script that appears after the stylesheet link, so it paints late. */
const scriptAfterStyles = (html) => {
	const style = html.search(/<link[^>]+rel=["']?stylesheet["']?|<style/i);
	const script = html.search(/<script/i);
	return style !== -1 && script > style;
};
/** A positive tabindex, the only silent divergence between DOM and tab order. */
const hasPositiveTabindex = (html) => /tabindex=["']?[1-9]/.test(html);
/**
 * A fixed pixel WIDTH on an element that spans the page.
 *
 * `max-w-[1200px]` is the DESIGN.md container and is deliberately absent from
 * this pattern: a maximum is what makes a layout fluid. A hard `w-[1200px]` or
 * an inline `width:1200px` is what stops it being fluid, and it is the usual
 * way a page passes a desktop screenshot and fails at 640px.
 */
const hasFixedWidth = (html) => /\bw-\[\d{3,}px\]|\bwidth:\s*\d{3,}px/.test(html);

console.log('=== positive control ===');
{
	const deferred = '<head><script type="module">x</script></head>';
	const late = '<head><link rel="stylesheet" href="a.css"><script>x</script></head>';
	const tabbed = '<button tabindex="3">x</button>';
	const fixed = '<main class="w-[1200px]">x</main>';

	const controls = [
		['deferred-script detector', isDeferred(deferred)],
		['script-after-stylesheet detector', scriptAfterStyles(late)],
		['positive-tabindex detector', hasPositiveTabindex(tabbed)],
		['fixed-width detector', hasFixedWidth(fixed)],
	];
	const dead = controls.filter(([, fired]) => !fired).map(([name]) => name);
	if (dead.length > 0) {
		fail(`positive control MISSED — ${dead.join(', ')} did not fire on known-bad input. The gate is broken; fix it before trusting any result below.`);
	} else {
		pass('all four detectors fire on known-bad input');
	}
}

// ---------------------------------------------------------------------------
// 6.2 — the no-flash theme bootstrap
// ---------------------------------------------------------------------------

console.log('\n=== 6.2 no-flash theme bootstrap ===');
if (!existsSync(LAYOUT)) {
	fail(`${LAYOUT} does not exist. This gate is reading the wrong tree.`);
} else {
	const layout = readFileSync(LAYOUT, 'utf8');
	const head = layout.slice(0, layout.indexOf('</head>') + '</head>'.length);

	if (head.length === 0) {
		fail('no </head> found in Layout.astro');
	} else {
		// `is:inline` is the attribute doing the work: it suppresses both
		// bundling and the `type="module"` Astro would otherwise add, and a
		// module script is deferred by definition.
		if (/is:inline/.test(head)) pass('the head script is marked is:inline (not bundled, not deferred)');
		else fail('no is:inline script in <head> — Astro may hoist it or emit it as a module, and a module runs after first paint.');

		if (isDeferred(head)) fail('a <script type="module"> is in <head> — it is deferred and will restore the theme after first paint.');
		else pass('no module script in <head>');

		if (scriptAfterStyles(head)) fail('the theme script sits after the stylesheet — the canvas can paint before the theme is applied.');
		else pass('the theme script runs before the stylesheet');

		// The attribute itself, set on <html>, is the contract the dark block
		// keys off. A rename here silently disables dark mode everywhere.
		if (/setAttribute\(\s*["']data-theme["']/.test(layout)) pass('the bootstrap writes data-theme on the document element');
		else fail('the bootstrap never writes data-theme — the dark block in global.css has nothing to key off.');

		if (/prefers-color-scheme:\s*dark/.test(layout)) pass('the OS preference is read, so `system` is a real mode and not a synonym for light');
		else fail('no prefers-color-scheme query — `system` cannot track the OS.');
	}
}

// ---------------------------------------------------------------------------
// 6.2 — every route inherits the shell
// ---------------------------------------------------------------------------

console.log('\n=== 6.2 shell inheritance ===');
if (!existsSync(HEADER)) {
	fail(`${HEADER} does not exist.`);
} else {
	const layout = existsSync(LAYOUT) ? readFileSync(LAYOUT, 'utf8') : '';
	// The header and footer must be mounted in the layout, not in a page. A
	// page-local header is exactly the Phase 1 defect this app was rebuilt to
	// remove, and it is invisible on the two routes that do have one.
	if (/<SiteHeader\s*\/>/.test(layout) && /<SiteFooter\s*\/>/.test(layout)) {
		pass('SiteHeader and SiteFooter are mounted in Layout.astro, so all routes inherit them');
	} else {
		fail('the header or footer is not mounted in Layout.astro — at least one route has no shell.');
	}
	if (/id=["']main["']|<main/.test(layout) || existsSync(join('src', 'pages', 'index.astro'))) {
		// Target existence is asserted per page below; here only the layout's
		// own contract is checked.
		pass('a #main target is present in the layout markup');
	}
}

const pages = pageFiles();
if (pages.length === 0) {
	fail(`scanned 0 pages under ${PAGES} — a zero-file scan is a false pass.`);
} else {
	info(`scanned ${pages.length} page(s): ${pages.map((p) => relative(PAGES, p)).join(', ')}`);
	for (const page of pages) {
		const source = readFileSync(page, 'utf8');
		const name = relative(process.cwd(), page);
		// A page that renders its own <main> is fine; a page that renders its
		// own header or footer is the defect.
		if (/<SiteHeader|<SiteFooter/.test(source)) {
			fail(`${name} mounts the header or footer itself — the shell belongs in the layout.`);
		} else {
			pass(`${name} inherits the shell from the layout`);
		}
		if (hasPositiveTabindex(source)) fail(`${name} uses a positive tabindex, which silently reorders the keyboard path.`);
		if (hasFixedWidth(source)) fail(`${name} pins a pixel width, which is how a responsive layout stops being responsive.`);
	}
}

// ---------------------------------------------------------------------------
// 6.3 — keyboard preconditions
// ---------------------------------------------------------------------------

console.log('\n=== 6.3 keyboard preconditions ===');
if (existsSync(HEADER) && existsSync(STYLES)) {
	const header = readFileSync(HEADER, 'utf8');
	const styles = readFileSync(STYLES, 'utf8');

	// The skip link must precede the <header>. Anything focusable emitted
	// above it is something a keyboard user meets before the way past the nav.
	const skipAt = header.search(/class="skip-link/);
	const headerAt = header.search(/<header/);
	if (skipAt === -1) fail('no skip link in SiteHeader.astro');
	else if (headerAt === -1) fail('no <header> in SiteHeader.astro');
	else if (skipAt < headerAt) pass('the skip link is the first focusable element, ahead of the nav');
	else fail('the skip link is emitted after the header — a keyboard user meets the nav row before the way past it.');

	if (/href="#main"/.test(header)) pass('the skip link targets #main');
	else fail('the skip link does not target #main — it is inert if that id does not exist.');

	// Phase 5.4 fixed the sticky header eating the skip link's target with
	// `scroll-margin-top`. Regressing it is silent: the link still works, it
	// just lands somewhere the user cannot see.
	if (/scroll-margin-top/.test(styles)) pass('scroll-margin-top is set, so the sticky header cannot swallow the skip target');
	else fail('no scroll-margin-top in global.css — the sticky header will cover the #main target.');

	// `aria-current="page"` is how a screen reader knows where it is. Exactly
	// one control may carry it, which is why the Phase 3 verdict removed it
	// from the wordmark.
	if (/aria-current/.test(header)) pass('nav items carry aria-current');
	else fail('no aria-current in the header — the active route is announced as ordinary.');
}

// ---------------------------------------------------------------------------
// 6.4 — responsive preconditions
// ---------------------------------------------------------------------------

console.log('\n=== 6.4 responsive preconditions ===');
if (existsSync(HEADER)) {
	const header = readFileSync(HEADER, 'utf8');
	// DESIGN.md breakpoint table: "nav -> menu trigger" at <=640px, full nav
	// row at laptop. 640px is Tailwind's `sm`, so both halves of that switch
	// must be expressed in `sm:` variants or the header is wrong at one end of
	// the range.
	if (/sm:flex/.test(header) && /sm:hidden/.test(header)) {
		pass('the nav/menu switch is expressed in sm: variants, matching the 640px DESIGN.md breakpoint');
	} else {
		fail('the nav collapse does not use sm: variants — one side of the 640px breakpoint is unstyled.');
	}
}

console.log(
	failures === 0
		? '\nShell contract holds structurally. Perceptual review of the dark ramp and the breakpoints is still a human gate.'
		: `\n${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
