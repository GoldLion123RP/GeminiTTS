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
			const isMissingKey = /GEMINI_API_KEY is not set/.test(message);
			console.log(`✗ live-token    ${token.status} — ${message}`);
			if (isMissingKey) {
				// The key is genuinely absent from process.env. Two very
				// different causes, so both are named rather than guessing.
				console.error('');
				console.error('  The server cannot see GEMINI_API_KEY. Which is it?');
				console.error('   • .env does not exist or has no GEMINI_API_KEY= line');
				console.error('   • the server was started WITHOUT --env-file-if-exists=.env');
				console.error('');
				console.error('  Fix: use `bun run dev` (loads .env), or `bun run start`');
				console.error('  (adds --env-file-if-exists=.env).');
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
