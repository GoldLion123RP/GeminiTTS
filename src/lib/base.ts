/**
 * One place that knows where the site is mounted.
 *
 * Astro rewrites `base` into `import.meta.env.BASE_URL` but it does NOT rewrite
 * hand-written `href="/speech-to-text"` strings, and `NAV_ITEMS` in `nav.ts` is
 * exactly that: a hand-written route table. Under the node deployment the site
 * is at `/` and those strings are correct; under the Pages deployment it is at
 * `/GeminiTTS/` and every one of them is a 404. Rather than sprinkle
 * `${import.meta.env.BASE_URL}` through components — and get it subtly wrong at
 * the one call site that already ends in a slash — every internal link goes
 * through `withBase()`.
 *
 * `'/'` returns the base itself rather than `'/'` — a home link of `href="/"`
 * under Pages would leave the site entirely, which is the one link that must
 * not get this wrong.
 */

/** Deployment path prefix. `/` locally and on a node host, `/GeminiTTS/` on Pages. */
const BASE = import.meta.env.BASE_URL || '/';

/** Normalised to a leading slash and no trailing slash, so joins are unambiguous. */
const PREFIX = BASE === '/' ? '' : BASE.replace(/\/$/, '');

/**
 * Prefix a root-relative path with the deployment base.
 *
 * `'/'` returns the base itself rather than `'/'` — a home link of `href="/"`
 * under Pages would leave the site entirely, which is the one link that must
 * not get this wrong.
 */
export function withBase(path: string): string {
	if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith('#')) return path;
	if (path === '/' || path === '') return `${PREFIX}/`;
	const withSlash = path.startsWith('/') ? path : `/${path}`;
	return `${PREFIX}${withSlash}`;
}
