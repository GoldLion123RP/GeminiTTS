#!/usr/bin/env node
// Smoke check for the built server.
//
// WHY THIS EXISTS
//
// Phase 6 was verified by running `node dist/server/entry.mjs` and driving the
// page in a browser. Every Gemini call failed with "GEMINI_API_KEY is not set",
// and that was read as "the user has no key". They did have one. The cause was
// the command:
//
//   getSecret() compiles down to `process.env[key]` — nothing more. Astro
//   populates process.env in `astro dev` and `astro build`, but the standalone
//   server bundle loads no .env at all. So `bun run build && node
//   dist/server/entry.mjs` starts a server that cannot possibly see .env.
//
//   The failure is silent in a specific way: it looks exactly like a missing
//   or malformed key, so the natural next step is to go and inspect the key.
//   The key was fine. The environment was not.
//
// This script makes that class of mistake self-diagnosing. It distinguishes
// the two situations, which is the distinction the error message itself cannot
// make.
//
// SECRECY
//
// This script NEVER reads, prints, or logs GEMINI_API_KEY, and never reads
// .env. It asks the server what it sees and reports only a boolean. That is
// enough to separate "no .env" from "bad key", which is the whole point.
//
// USAGE
//
//   bun run build
//   bun run smoke              # uses PORT, defaults to 4321
//
// A non-zero exit means the check failed. A 401/403 from Gemini means the key
// is present but rejected — that is a real answer, not a script failure.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT ?? 4321);
const HOST = '127.0.0.1';
const ENTRY = 'dist/server/entry.mjs';

/**
 * `readJsonBody` pulls the body out of a fetch Response without throwing on a
 * non-2xx. The error text is the payload we actually care about here.
 */
async function body(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

if (!existsSync(ENTRY)) {
	console.error(`✗ ${ENTRY} not found. Run \`bun run build\` first.`);
	process.exit(1);
}

console.log(`Starting ${ENTRY} on ${HOST}:${PORT} …`);

// `--env-file-if-exists` is Node's built-in loader, so the server sees the same
// environment a developer would expect without a dotenv dependency.
const server = spawn(
	process.execPath,
	['--env-file-if-exists=.env', ENTRY],
	{ env: { ...process.env, PORT: String(PORT), HOST }, stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

/** Polls until the server answers, or gives up. */
async function waitForServer(attempts = 25) {
	for (let i = 0; i < attempts; i++) {
		try {
			const response = await fetch(`http://${HOST}:${PORT}/`);
			if (response.ok || response.status === 404) return true;
		} catch {
			/* not up yet */
		}
		await sleep(200);
	}
	return false;
}

let exitCode = 0;
try {
	if (!(await waitForServer())) {
		console.error('✗ Server did not start within 5s.');
		console.error(serverLog.trim());
		exitCode = 1;
	} else {
		const page = await fetch(`http://${HOST}:${PORT}/`);
		const html = await page.text();
		console.log(`✓ page          ${page.status} (${html.length} bytes)`);

		// The panels are the thing we actually built, so their presence is the
		// cheapest proof that the served HTML is the current build and not a
		// stale dist/ left over from an earlier phase.
		//
		// PHASE 3 CHANGE: the panels moved off `/` and onto their own routes,
		// so this no longer looks for them on the landing page. Instead each
		// tool is checked on the route that now owns it, and `/` is checked
		// for the ABSENCE of both. That negative check is the part worth
		// having: it is what catches a leftover import in `index.astro` that
		// would silently put both full tools back on the landing page.
		const routes = [
			{ path: '/speech-to-text', marker: 'id="stt"', label: 'STT panel' },
			{ path: '/text-to-speech', marker: 'id="tts"', label: 'TTS panel' },
		];

		for (const route of routes) {
			const response = await fetch(`http://${HOST}:${PORT}${route.path}`);
			const body = await response.text();
			const present = body.includes(route.marker);
			console.log(
				`${present ? '✓' : '✗'} ${route.label.padEnd(12)} ${route.path} → ${present ? 'present' : `MISSING (${response.status})`}`,
			);
			if (!present) exitCode = 1;
		}

		const landingIsClean = !html.includes('id="stt"') && !html.includes('id="tts"');
		console.log(
			`${landingIsClean ? '✓' : '✗'} landing      ${landingIsClean ? 'no tool panels' : 'STILL MOUNTING A TOOL PANEL'}`,
		);
		if (!landingIsClean) exitCode = 1;

		// PHASE 5.4: the shared chrome, checked on a route that owns a tool.
		//
		// These are the assertions a screenshot would show as "looks fine" and
		// a regression would make invisible. A dropped skip link or a stripped
		// `theme-color` leaves the page looking correct; it is only the
		// keyboard user, the mobile status bar, or the balance of a headline
		// that notices.
		const tts = await fetch(`http://${HOST}:${PORT}/text-to-speech`);
		const ttsHtml = await tts.text();
		const chrome = [
			{ label: 'skip link', ok: ttsHtml.includes('Skip to content') && ttsHtml.includes('href="#main"') },
			{ label: 'theme-color', ok: ttsHtml.includes('name="theme-color"') },
			{ label: 'quota meter', ok: ttsHtml.includes('id="quota"') },
			{ label: 'aria-current nav', ok: ttsHtml.includes('aria-current="page"') },
		];
		for (const item of chrome) {
			console.log(`${item.ok ? '✓' : '✗'} chrome       ${item.label} ${item.ok ? 'present' : 'MISSING'}`);
			if (!item.ok) exitCode = 1;
		}

		// Reduced motion lives in the stylesheet, not the HTML — the first
		// version of this check looked in the page and correctly reported it
		// missing, which is a reminder that an assertion against the wrong
		// artifact reports a false failure just as confidently as a false
		// pass. The stylesheet is resolved from the page's own <link>, so this
		// reads the CSS the browser would.
		const cssHref = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(ttsHtml)?.[1];
		let reducedMotion = false;
		if (cssHref) {
			const css = await (await fetch(new URL(cssHref, `http://${HOST}:${PORT}`))).text();
			reducedMotion = css.includes('prefers-reduced-motion');
		}
		console.log(
			`${reducedMotion ? '✓' : '✗'} chrome       reduced motion ${reducedMotion ? 'present in CSS' : 'MISSING (stylesheet unreadable or rule absent)'}`,
		);
		if (!reducedMotion) exitCode = 1;

		// PHASE 6.2: the no-flash proof, asserted against the SERVED html.
		//
		// Why this is here and not in the browser matrix: a real browser
		// cannot prove "there is no flash". A CDP screencast only sees frames
		// the compositor actually produced, and the Phase 6 control run
		// injected a genuine light-first paint that the screencast did NOT
		// report — the whole document is parsed and styled before the first
		// frame is produced, so a sub-frame flash is unobservable by
		// construction. Three in-page probes failed the same way, each
		// reading a transparent or unstyled canvas. A check that cannot fail
		// is not a check, so the guarantee is asserted where it is actually
		// provable: in the byte order of the response.
		//
		// The claim is a proof, not a sample. The canvas colour is derived
		// from the `data-theme` attribute, and the attribute is set by an
		// inline script that appears inside <head> — before <body> exists and
		// before the render-blocking stylesheet. So at the earliest instant
		// any paint is possible, the correct value is already in place. If
		// the script is hoisted, deferred, moved below the stylesheet, or
		// pushed past </head>, a light frame becomes possible and this fails.
		const headEnd = ttsHtml.indexOf('</head>');
		const bodyStart = ttsHtml.indexOf('<body');
		const bootstrap = ttsHtml.search(/setAttribute\(\s*['"]data-theme['"]/);
		const scriptTag = ttsHtml.lastIndexOf('<script', bootstrap);
		const styleLink = ttsHtml.search(/<link[^>]+rel="stylesheet"/);
		const noFlash =
			headEnd !== -1 &&
			bodyStart !== -1 &&
			bootstrap !== -1 &&
			scriptTag !== -1 &&
			scriptTag < headEnd &&
			headEnd <= bodyStart &&
			(styleLink === -1 || scriptTag < styleLink);
		console.log(
			`${noFlash ? '✓' : '✗'} chrome       no-flash ${noFlash ? 'bootstrap is inline in <head>, before <body> and before the stylesheet' : 'theme bootstrap is NOT ordered ahead of first paint'}`,
		);
		if (!noFlash) exitCode = 1;

		// The rate limiter, asserted the only way it can be asserted without
		// depending on a configured limit: the header is present on an API
		// response, which means `src/middleware.ts` ran and counted the
		// request.
		//
		// Deliberately NOT a burst of 31 requests. That would prove the limit
		// fires, but it would also fail on any deployment that raised
		// `RATE_LIMIT_HEALTH` or set it to 0 — a gate that breaks when the
		// operator configures the thing it is testing. The unit tests in
		// `src/lib/server/rate-limit.test.ts` cover the counting, the sliding
		// window, and the refusal; this covers the wiring, which unit tests
		// cannot see.
		const limited = await fetch(`http://${HOST}:${PORT}/api/health`);
		const remaining = limited.headers.get('x-ratelimit-remaining');
		const limitedOk = remaining !== null;
		console.log(
			`${limitedOk ? '✓' : '✗'} rate limit    ${limitedOk ? `middleware applied (${limited.status}, x-ratelimit-remaining=${remaining})` : 'NO x-ratelimit-remaining header — src/middleware.ts is not applied to /api/'}`,
		);
		if (!limitedOk) exitCode = 1;

		// A test file under src/pages/ used to ship as a live route. It is
		// gone (see `scripts/check-routes.mjs`), and this is the end-to-end
		// half of that check: the URL must not resolve to a page.
		const testRoute = await fetch(`http://${HOST}:${PORT}/api/endpoints.test`);
		const testGone = testRoute.status === 404;
		console.log(
			`${testGone ? '✓' : '✗'} route leak   /api/endpoints.test → ${testGone ? '404' : `REACHABLE (${testRoute.status})`}`,
		);
		if (!testGone) exitCode = 1;

		// PHASE 5.1: the endpoint that answers the question this script exists
		// to ask, asked directly instead of inferred from an error string.
		//
		// The live-token check below still has to run, but the diagnosis no
		// longer depends on pattern-matching a message. Previously "no .env"
		// and "bad key" were separated by looking for the words
		// "GEMINI_API_KEY is not set" in a 500 body — a rule that breaks the
		// moment someone improves the wording of that message.
		const health = await fetch(`http://${HOST}:${PORT}/api/health`);
		const report = await body(health);
		const state = report?.state ?? '(no state)';
		console.log(`✓ health         ${health.status} — ${state}${report?.detail ? `: ${report.detail}` : ''}`);

		// The endpoint that reads the key. This is the check that would have
		// caught the Phase 6 confusion in one command.
		const token = await fetch(`http://${HOST}:${PORT}/api/live-token`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ language: 'auto' }),
		});
		const payload = await body(token);

		if (token.ok && payload?.token && payload?.url) {
			console.log('✓ live-token    200 — the server can see a key');
			// Structure only. The token value is never logged.
			const shapeOk =
				String(payload.url).startsWith('wss://') &&
				String(payload.url).includes('access_token=') &&
				!String(payload.url).includes('AIza');
			console.log(`${shapeOk ? '✓' : '✗'} socket URL    ${shapeOk ? 'wss + ephemeral token, no raw key' : 'unexpected shape'}`);
			if (!shapeOk) exitCode = 1;
		} else {
			const message = payload?.error ?? '(no message)';
			console.log(`✗ live-token    ${token.status} — ${message}`);
			if (state === 'missing') {
				// The key is genuinely absent from process.env. Two very
				// different causes, so both are named rather than guessing.
				console.error('');
				console.error('  The server cannot see GEMINI_API_KEY. Which is it?');
				console.error('   • .env does not exist or has no GEMINI_API_KEY= line');
				console.error('   • the server was started WITHOUT --env-file-if-exists=.env');
				console.error('');
				console.error('  Fix: use `bun run dev` (loads .env), or `bun run start`');
				console.error('  (adds --env-file-if-exists=.env).');
			} else if (state === 'invalid') {
				// The key IS present and Gemini rejected it. This is the case
				// the old string-matching heuristic misfiled as a missing key.
				console.error('');
				console.error('  GEMINI_API_KEY is set but Gemini rejected it. The .env file is');
				console.error('  being read correctly; the credential itself is the problem.');
			} else if (state === 'quota_exhausted') {
				console.error('');
				console.error('  The key works, but the project is out of quota. Free-tier limits');
				console.error('  reset at midnight Pacific; a paid key removes the ceiling.');
			}
			exitCode = 1;
		}
	}
} finally {
	server.kill();
}

if (exitCode !== 0) {
	const trimmed = serverLog.trim();
	if (trimmed) {
		console.error('--- server output ---');
		console.error(trimmed);
	}
}
process.exit(exitCode);
