#!/usr/bin/env node
/**
 * STT end-to-end + Smart-mode verification (plan 6.6).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NEVER EXECUTED. No Gemini credential was available in the environment    │
 * │ where this was written, so there is no output from it and no claim that  │
 * │ it passes. It is shipped as the exact procedure the inherited open item  │
 * │ needs, not as evidence. Run it with a working key before trusting it.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT IT SETTLES
 *
 * Two things are unproven after every prior phase, and both are the same
 * single test:
 *
 *   1. The speech-to-text path has never completed a real request against the
 *      live API.
 *   2. Smart mode may be SILENTLY downgraded to Verbatim. `transcribe.ts`
 *      passes `config.audioTranscriptionConfig.mode = SMART`, which is the
 *      typed field on the `generateContent` path. The transcribe
 *      documentation documents a differently-named REST field
 *      (`transcription_config`) on the Interactions path, which the typed SDK
 *      cannot combine with an audio input. If the backend ignores the field we
 *      send, the app ships Verbatim output with no error and worse quality —
 *      the worst kind of failure, because it looks like success.
 *
 * WHY AN ENUMERATED LIST IS THE DISCRIMINATOR
 *
 * Smart mode performs its own formatting: it emits paragraphs and lists for
 * spoken structure. Verbatim mode is a faithful transcript and does not invent
 * that structure. So the passage below says "first… second… third…" in one
 * breath, and the check is whether the output comes back as a list or as a flat
 * run of prose. Per the SDK's own docstring, a flat wall of text means the
 * config was ignored.
 *
 * A synthetic tone is generated rather than a recording: it keeps the test
 * reproducible, needs no microphone, and still carries real speech-shaped
 * audio. Swap `--audio <file>` to use a real recording.
 *
 * USAGE
 *
 *   bun run verify:stt                 # synthesised passage, Smart mode
 *   bun run verify:stt -- --mode verbatim   # control: must come back flat
 *   bun run verify:stt -- --audio ./speech.webm
 *
 * Requires `GEMINI_API_KEY` in the environment (server-side). It spends one
 * TTS request to build the audio and one STT request to transcribe it, so it
 * costs two requests of the free tier's daily budget. Read
 * `GET /api/health` first: it probes `models?pageSize=1` and costs no quota.
 */

import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_KEY = process.env.GEMINI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const argv = process.argv.slice(2);
const argValue = (flag) => {
	const at = argv.indexOf(flag);
	return at === -1 ? undefined : argv[at + 1];
};
const mode = (argValue('--mode') ?? 'smart').toUpperCase();
const audioPath = argValue('--audio');

/** The passage that discriminates Smart from Verbatim. */
const PASSAGE = [
	'Here are the three reasons this matters.',
	'First, the cost is unpredictable.',
	'Second, the failure is silent.',
	'Third, and this is the important one, the retry doubles the bill.',
].join(' ');

if (!API_KEY) {
	console.error('GEMINI_API_KEY is not set. This test needs a working key.');
	console.error('Read GET /api/health first — it distinguishes "not loaded" from "rejected".');
	process.exit(2);
}

/** Synthesise the passage, unless a real recording was supplied. */
async function buildAudio() {
	if (audioPath) {
		const { readFile } = await import('node:fs/promises');
		return { bytes: await readFile(audioPath), mime: 'audio/webm' };
	}
	const response = await fetch(`${BASE}/models/gemini-2.5-flash:generateContent`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
		body: JSON.stringify({
			contents: [{ parts: [{ text: `Say this exactly, with a pause between each sentence: ${PASSAGE}` }] }],
			generationConfig: {
				responseModalities: ['AUDIO'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
			},
		}),
	});
	if (!response.ok) {
		throw new Error(`synthesis failed: ${response.status} ${await response.text()}`);
	}
	const json = await response.json();
	const inline = json?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
	if (!inline?.data) throw new Error('synthesis returned no audio');
	return { bytes: Buffer.from(inline.data, 'base64'), mime: inline.mimeType ?? 'audio/wav' };
}

const { bytes, mime } = await buildAudio();
const file = join(tmpdir(), `geminitts-stt-verify.${mime.includes('wav') ? 'wav' : 'webm'}`);
await writeFile(file, bytes);
console.log(`audio: ${bytes.length} bytes of ${mime} (${PASSAGE.split(' ').length}-word passage)`);

const response = await fetch(`${BASE}/models/gemini-3.5-transcribe:generateContent`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
	body: JSON.stringify({
		contents: [{ parts: [{ inlineData: { mimeType: mime, data: bytes.toString('base64') } }] }],
		config: { audioTranscriptionConfig: { mode } },
	}),
});

const body = await response.text();
await unlink(file).catch(() => {});

if (!response.ok) {
	console.error(`\ntranscription failed: ${response.status}`);
	console.error(body.slice(0, 800));
	console.error(
		response.status === 429
			? '\n429 = the free tier daily quota is spent. /api/health reports this as `quota_exhausted`; it is an account condition, not a regression.'
			: '',
	);
	process.exit(1);
}

const transcript = JSON.parse(body)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
console.log(`\nstatus:  200  (mode requested: ${mode})`);
console.log(`transcript:\n${transcript}\n`);

// Verbatim is a flat run of prose. Smart restructures spoken structure into
// paragraphs or list items. The discriminator is line structure, not wording.
const lines = transcript.split('\n').map((line) => line.trim()).filter(Boolean);
const listLines = lines.filter((line) => /^(?:[-*•]|\d+[.)])\s/.test(line));
const paragraphs = lines.length;

const verdict =
	mode === 'VERBATIM'
		? paragraphs === 1
			? { ok: true, why: 'flat prose, as Verbatim should be — the control behaved' }
			: { ok: false, why: `${paragraphs} blocks returned in VERBATIM mode — the mode is not being honoured at all` }
		: paragraphs > 1 || listLines.length > 0
			? { ok: true, why: `${paragraphs} blocks, ${listLines.length} list items — Smart mode is in effect` }
			: { ok: false, why: 'a single flat block — audioTranscriptionConfig was ignored and Smart was downgraded to Verbatim' };

console.log(`verdict: ${verdict.ok ? 'PASS' : 'FAIL'} — ${verdict.why}`);
console.log(
	verdict.ok && mode !== 'VERBATIM'
		? '\nThe inherited open item is settled: STT works end to end and Smart mode is honoured. Record it in the plan changelog.'
		: verdict.ok
			? '\nControl behaved. Now run the default (Smart) to settle the real question.'
			: '\nDo not trust transcripts until this is fixed — the app is shipping Verbatim while reporting success.',
);
process.exit(verdict.ok ? 0 : 1);
