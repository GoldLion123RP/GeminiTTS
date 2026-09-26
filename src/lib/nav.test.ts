import { describe, expect, it } from 'bun:test';
import { isActive, normalizePath, NAV_ITEMS, visibleNavItems } from './nav';

describe('normalizePath', () => {
	it('leaves the root alone', () => {
		expect(normalizePath('/')).toBe('/');
	});

	// Astro serves directories with a trailing slash. A bare `=== '/'` test
	// for the home route would therefore never match, and no nav link on the
	// landing page would be marked current.
	it('strips a trailing slash from a route path', () => {
		expect(normalizePath('/speech-to-text/')).toBe('/speech-to-text');
	});

	it('strips repeated trailing slashes', () => {
		expect(normalizePath('/speech-to-text///')).toBe('/speech-to-text');
	});

	it('returns the root for a slash-only path', () => {
		expect(normalizePath('///')).toBe('/');
	});

	it('leaves an extension-bearing path intact', () => {
		expect(normalizePath('/favicon.svg')).toBe('/favicon.svg');
	});
});

describe('isActive', () => {
	it('matches the root', () => {
		expect(isActive('/', '/')).toBe(true);
	});

	it('matches a route regardless of trailing slash', () => {
		expect(isActive('/speech-to-text/', '/speech-to-text')).toBe(true);
		expect(isActive('/speech-to-text', '/speech-to-text/')).toBe(true);
	});

	// A prefix match would light up "Home" on every route, because `/` is a
	// prefix of everything.
	it('does not treat the root as a prefix of a deeper route', () => {
		expect(isActive('/speech-to-text', '/')).toBe(false);
	});

	it('does not match a different route', () => {
		expect(isActive('/text-to-speech', '/speech-to-text')).toBe(false);
	});

	it('does not match a nested path under a nav route', () => {
		expect(isActive('/speech-to-text/history', '/speech-to-text')).toBe(false);
	});
});

describe('NAV_ITEMS', () => {
	it('starts at the home route', () => {
		expect(NAV_ITEMS[0]?.href).toBe('/');
	});

	it('returns only the items flagged implemented', () => {
		const expected = NAV_ITEMS.filter((item) => item.implemented);
		expect(visibleNavItems()).toEqual(expected);
	});

	// The invariant the header actually depends on: a rendered link always
	// points at a route that exists. Asserted as a relationship rather than
	// as today's specific flags, so it keeps holding after Phase 3 flips
	// `/speech-to-text` and `/text-to-speech` on.
	it('never exposes an unimplemented route', () => {
		for (const item of visibleNavItems()) {
			expect(item.implemented).toBe(true);
		}
	});

	it('keeps the home route available', () => {
		expect(visibleNavItems().some((item) => item.href === '/')).toBe(true);
	});

	it('declares the not-yet-built routes so Phase 3 only flips a flag', () => {
		expect(NAV_ITEMS.map((item) => item.href)).toEqual([
			'/',
			'/speech-to-text',
			'/text-to-speech',
		]);
	});

	// Phase 3 flipped the two staging flags. This is the assertion that would
	// have failed had the pages landed without the flags being flipped — the
	// header would have kept rendering a single link while three routes
	// existed. Asserted as a count so a future route addition is a deliberate
	// edit here rather than a silent one.
	it('renders all three routes now that the pages exist', () => {
		expect(visibleNavItems()).toHaveLength(3);
	});

	it('gives every item a non-empty label', () => {
		for (const item of NAV_ITEMS) {
			expect(item.label.length).toBeGreaterThan(0);
		}
	});

	// `aria-current="page"` is a single-value attribute. Two links carrying it
	// simultaneously is not "extra emphasis", it is two controls each
	// announcing themselves as the current page to a screen reader. The
	// wordmark and the "Home" nav item are the pair that collides here, and
	// the fix belongs in the header rather than in this file.
	it('has exactly one distinct href per entry', () => {
		const hrefs = NAV_ITEMS.map((item) => item.href);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});
});
