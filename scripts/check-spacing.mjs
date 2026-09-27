#!/usr/bin/env node
/**
 * Vertical-rhythm gate — the "two panels are welded together" defect.
 *
 * THE BUG THIS EXISTS TO KEEP FIXED
 *
 * `<main>` on both tool pages stacks three bordered panels. Two of them carried
 * `mt-6`; `ByokSettings` did not. The visible consequence was two 1px-bordered
 * cards sitting flush, their borders merging into a single rule, so the column
 * read as one malformed box. It shipped because the margin is invisible in a
 * screenshot when the border is 1.14:1, and because nothing in the toolchain
 * looks at vertical rhythm at all: `astro check` sees no type error, `bun test`
 * sees no function, and `check:panel` — the one gate that reads the real DOM —
 * was pointed at the TTS cost gate, not at layout.
 *
 * WHAT IT CHECKS
 *
 * A declared list of sibling stacks, asserted against the BUILT HTML, not the
 * source. Built, because the source is what the author reads and the artifact is
 * what the browser receives; `check:panel` established that distinction for
 * this repo and this gate follows it.
 *
 * For each adjacent pair, the later sibling must either carry a non-negative
 * top margin or inherit a gap from the parent (`space-y-*` on a block, or
 * `gap-*` on a flex/grid column). Both are legitimate ways to space a stack, so
 * the gate asserts the OUTCOME — a non-zero vertical gap — and not one
 * particular class name. A gate that pinned `mt-6` would be a gate that has to
 * be edited the first time someone spaces the column the other way, and a gate
 * that is edited to accommodate is a gate that stops being run.
 *
 * It asserts `> 0`, not `=== 24px`. The 24 is DESIGN.md's `{spacing.lg}` and
 * it is the right answer today; pinning it would make a deliberate rhythm
 * change a test failure rather than a one-line edit.
 *
 *   1. POSITIVE CONTROL: a synthetic page with the margin omitted MUST fail,
 *      naming the unspaced panel. A gate that has never been observed to fail
 *      is not a gate — and this one is written against a bug that shipped.
 *   2. POSITIVE CONTROL: the same page, spaced by the parent instead of the
 *      child, MUST pass. Otherwise the escape hatch above is decoration.
 *   3. The real prerendered pages, when a static build is on disk.
 *
 * Usage: `bun run check:spacing` (run after a build; see the skip note below).
 *
 * WHY A NODE BUILD SKIPS STEP 3
 *
 * `output: 'server'` renders its HTML on demand; there is no `.html` on disk to
 * read, so there is nothing for this gate to look at. The controls still run,
 * so the gate can still be *seen* to fail, and CI — which builds the static
 * target in `.github/workflows/pages.yml` — asserts the real pages. Skipping is
 * reported on stdout rather than passed over in silence, because a gate that
 * quietly checks nothing is the failure mode this file exists to avoid.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * The stacks that must be spaced, as data.
 *
 * `children` is in DOCUMENT order, and the gate asserts that order too: a
 * reordered column would be a different page, and one that is silent about it
 * would let a reordering pass a check that is nominally about spacing.
 */
const STACKS = [
	{ page: 'text-to-speech', parent: 'main', children: ['tts', 'quota', 'byok'] },
	{ page: 'speech-to-text', parent: 'main', children: ['stt', 'quota', 'byok'] },
];

const DIST = 'dist';
const CLIENT = `${DIST}/client`;

/** Tailwind spacing steps, so the accepted set stays exactly this design system. */
const POSITIVE = /^(\d+(?:\.\d+)?)$/;

/**
 * A margin (or gap) utility in a class list, read as a signed step.
 *
 * Returns the number of spacing steps, `null` when the class list carries no
 * such utility at all, and `NaN` when it carries one this gate cannot read
 * (`mt-[24px]`, a variant-prefixed `md:mt-6`, a responsive `sm:mt-6` pair).
 * `NaN` is deliberately distinct from `null`: a designer who reaches for an
 * arbitrary value deserves to be told this gate cannot see it, not to be told
 * their panel is unspaced.
 */
function stepOf(classes, pattern) {
	let found = null;
	for (const token of classes.split(/\s+/)) {
		const match = pattern.exec(token);
		if (!match) continue;
		// First writer wins, and Tailwind's own rule is the same: a later class
		// in the list does not undo an earlier one, it is emitted in a fixed
		// order. Reading only the first keeps this gate from guessing at
		// specificity between `mt-6` and `mt-8`.
		if (found !== null) continue;
		const [, sign, value] = match;
		if (!POSITIVE.test(value)) {
			found = Number.NaN;
		} else {
			found = sign === '-' ? -Number(value) : Number(value);
		}
	}
	return found;
}

/** `mt-*` and `my-*`, signed. `my` counts: it is a real top margin. */
const TOP_MARGIN = /^(-?)(?:mt|my)-(.+)$/;

/** Parent-side spacing: `space-y-*` on a block, or `gap-*` on a flex column. */
const PARENT_GAP = /^(-?)(?:space-y|gap)-(.+)$/;

/** Every opening tag with its attributes, in document order. */
function openTags(html) {
	return [...html.matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)].map(
		(match) => ({
			tag: match[1].toLowerCase(),
			attrs: match[2],
			index: match.index,
		}),
	);
}

const classOf = (tag) => /class="([^"]*)"/.exec(tag.attrs)?.[1] ?? '';

/**
 * The span of an element, from its opening `<tag` to the first matching
 * `</tag>` after it.
 *
 * A first-match close, not a nesting-aware scan: these are `<main id="main">`
 * elements with no nested same-name element, and a real parser is not
 * available to a gate that must run with no dependency. If a page ever nests
 * its own `<main>`, this window is wrong — and the failure is a false *pass*
 * on a mis-scoped page, so the element count is checked below.
 */
function spanOf(html, tags, id) {
	const start = tags.find((tag) => new RegExp(`\\bid="${id}"`).test(tag.attrs));
	if (!start) return null;
	const openEnd = html.indexOf('>', start.index);
	const closer = new RegExp(`</${start.tag}\\s*>`, 'i').exec(html.slice(openEnd));
	if (!closer) return null;
	return { start, inner: html.slice(openEnd + 1, openEnd + 1 + closer.index) };
}

/**
 * Violations in one stack. Pure — no filesystem, no globals — so the positive
 * controls exercise exactly the code the real pages do.
 */
export function auditStack(html, stack) {
	const tags = openTags(html);
	const parent = spanOf(html, tags, stack.parent);
	if (!parent) return [`no element with id="${stack.parent}" — the page's layout wrapper is gone or renamed`];

	const window = parent.inner;
	const windowTags = openTags(window);
	const positions = [];
	for (const child of stack.children) {
		const tag = windowTags.find((t) => new RegExp(`\\bid="${child}"`).test(t.attrs));
		if (!tag) return [`no element with id="${child}" inside #${stack.parent} — the panel was renamed, moved out of the column, or dropped`];
		positions.push({ child, classes: classOf(tag) });
	}

	const order = positions.map((p) => p.child).join(' > ');
	const expected = stack.children.join(' > ');
	if (order !== expected) return [`#${stack.parent} reads ${order}; the declared order is ${expected}`];

	const problems = [];

	// A parent that spaces its own children exempts every child. Checked once,
	// before the pairwise walk, so a page converted to `flex flex-col gap-6` is
	// reported as correct rather than as three separate failures.
	const parentGap = stepOf(classOf(parent.start), PARENT_GAP);
	if (parentGap !== null && !(parentGap <= 0)) return [];

	for (let i = 1; i < positions.length; i++) {
		const below = positions[i - 1];
		const above = positions[i];
		const margin = stepOf(above.classes, TOP_MARGIN);

		if (margin === null) {
			problems.push(
				`#${above.child} sits directly below #${below.child} with no top margin and no gap on #${stack.parent}. ` +
					'Two bordered cards flush against each other read as one box.',
			);
			continue;
		}
		if (Number.isNaN(margin)) {
			problems.push(
				`#${above.child} carries a top margin this gate cannot evaluate (class="${above.classes}"). ` +
					'Use a numeric step from DESIGN.md, or add space-y-*/gap-* to the parent.',
			);
			continue;
		}
		if (margin <= 0) {
			problems.push(`#${above.child} has a non-positive top margin (${margin} steps) below #${below.child}.`);
		}
	}

	return problems;
}

let failures = 0;
const fail = (message) => {
	failures++;
	console.log(`FAIL  ${message}`);
};
const pass = (message) => console.log(`pass  ${message}`);
const skip = (message) => console.log(`skip  ${message}`);

/** One page of the synthetic control, in the shape the real build emits. */
function fixture(childrenClasses, parentClasses = 'container-page pb-24') {
	return [
		'<!doctype html><html><body>',
		`<main id="main" class="${parentClasses}">`,
		...childrenClasses.map(([id, classes]) => `<section id="${id}" class="${classes}"></section>`),
		'</main></body></html>',
	].join('\n');
}

console.log('=== positive control: the defect this gate exists to catch ===');
// The exact shipped shape: first panel unspaced (it is the top of the column and
// needs nothing), second spaced, third NOT — which is `ByokSettings` on
// `main`. The control must fail, and must name the third panel.
const STACK = STACKS[0];
const controlIds = STACK.children;
const defect = fixture(
	controlIds.map((id, index) => [id, index === 1 ? 'mt-6 rounded-app border border-hairline' : 'rounded-card border border-hairline']),
);
const caught = auditStack(defect, STACK);
if (caught.length !== 1 || !caught[0].includes(`#${controlIds[2]}`)) {
	fail(
		`positive control MISSED — an unspaced ${controlIds[2]} produced ${
			caught.length === 0 ? 'no violation' : caught.join(' / ')
		}. This check cannot fail, so it proves nothing.`,
	);
} else {
	pass(`an unspaced #${controlIds[2]} is caught: ${caught[0]}`);
}

console.log('\n=== positive control: the parent-side escape hatch is real ===');
// Same column, no child margins, `space-y-6` on the parent. A gate that
// rejected this would be pinning one implementation, and the first deliberate
// rhythm change would take it down with a failure that says nothing.
const byParent = fixture(
	controlIds.map((id) => [id, 'rounded-card border border-hairline']),
	'container-page pb-24 space-y-6',
);
const parentCaught = auditStack(byParent, STACK);
if (parentCaught.length > 0) {
	fail(`a column spaced by \`space-y-6\` on the parent was rejected: ${parentCaught.join(' / ')}`);
} else {
	pass('a column spaced by the parent passes, so the gate asserts the gap and not the class name');
}

console.log('\n=== built pages ===');
let pageHtml = 0;
for (const stack of STACKS) {
	const file = `${CLIENT}/${stack.page}/index.html`;
	if (!existsSync(file)) {
		skip(`no prerendered ${stack.page}/index.html on disk — a node build renders HTML on demand. CI builds the static target and asserts it.`);
		continue;
	}
	pageHtml++;
	const html = readFileSync(file, 'utf8');
	const problems = auditStack(html, stack);
	if (problems.length > 0) {
		for (const problem of problems) fail(`${stack.page}: ${problem}`);
	} else {
		pass(`${stack.page}: every stacked panel in #${stack.parent} carries a non-zero gap`);
	}
}
if (pageHtml === 0) {
	skip(`no prerendered pages under ${CLIENT}/ — the real-page check did not run. The controls above did.`);
}

console.log(
	failures === 0
		? '\nVertical rhythm holds. No two stacked panels touch.'
		: `\n${failures} failure(s). Stacked panels are touching.`,
);
process.exit(failures === 0 ? 0 : 1);
