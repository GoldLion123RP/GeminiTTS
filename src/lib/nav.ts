/**
 * Primary navigation — the single source of truth for the app chrome.
 *
 * `SiteHeader.astro` renders whatever this list contains and nothing else, so
 * the header can never drift from the route table.
 *
 * `implemented` exists because of a phase-ordering constraint, not a design
 * preference. Phase 1 of the plan builds the shell *before* Phase 3 creates
 * `/speech-to-text` and `/text-to-speech`. Emitting links to routes that do
 * not exist yet would ship two 404s in the primary chrome — the most visible
 * possible place to have one. So the links are declared now, carry their final
 * labels and order, and render as soon as their page lands.
 *
 * As of Phase 3 all three flags are `true`. The field is KEPT rather than
 * deleted: it is the mechanism that makes "never link a route without a page"
 * checkable, and `nav.test.ts` asserts the relationship rather than the
 * current values — so it keeps holding the next time a route is staged.
 */
export interface NavItem {
	/** Route path, absolute. */
	href: string;
	/** Visible label. */
	label: string;
	/**
	 * Whether the route exists yet. Entries with `false` are omitted from the
	 * rendered nav rather than linked.
	 */
	implemented: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
	{ href: '/', label: 'Home', implemented: true },
	{ href: '/speech-to-text', label: 'Speech to text', implemented: true },
	{ href: '/text-to-speech', label: 'Text to speech', implemented: true },
] as const;

/** The nav entries that currently have a page behind them. */
export function visibleNavItems(): NavItem[] {
	return NAV_ITEMS.filter((item) => item.implemented);
}

/**
 * Normalizes a request path for `aria-current` comparison.
 *
 * Astro's `Astro.url.pathname` carries a trailing slash for directories, so a
 * bare `=== '/'` test marks nothing active on the home page. Trailing slashes
 * are stripped everywhere except the root, which is its own path.
 */
export function normalizePath(pathname: string): string {
	if (pathname === '/') return '/';
	return pathname.replace(/\/+$/, '') || '/';
}

/** True when `pathname` is the route `href` points at. */
export function isActive(pathname: string, href: string): boolean {
	return normalizePath(pathname) === normalizePath(href);
}
