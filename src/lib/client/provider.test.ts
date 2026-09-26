import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { byokCovers, request, ROUTES, routeFor, usingByok } from './provider';
import { clearKey, looksLikeGeminiKey, normalizeKey, readKey, readMode, writeKey, writeMode } from './keystore';

/** A well-formed but obviously fake key. Never a real credential. */
const FAKE_KEY = `AIza${'x'.repeat(35)}`;

/** Minimal in-memory Storage. The keystore touches both stores unguarded. */
class MemoryStorage implements Storage {
	private readonly map = new Map<string, string>();

	get length(): number {
		return this.map.size;
	}

	clear(): void {
		this.map.clear();
	}

	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.map.delete(key);
	}

	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

let session: MemoryStorage;
let local: MemoryStorage;

/** Captures what would have gone over the wire, without going over it. */
const fetches: { url: string; init?: RequestInit }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
	session = new MemoryStorage();
	local = new MemoryStorage();
	(globalThis as { sessionStorage: Storage }).sessionStorage = session;
	(globalThis as { localStorage: Storage }).localStorage = local;
	fetches.length = 0;

	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		fetches.push({ url, init });
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('looksLikeGeminiKey', () => {
	it('accepts a well-formed key', () => {
		expect(looksLikeGeminiKey(FAKE_KEY)).toBe(true);
	});

	// The single most likely bad paste is the console URL rather than the key
	// itself, so a URL must not pass a shape check.
	it('rejects a pasted URL', () => {
		expect(looksLikeGeminiKey('https://aistudio.google.com/apikey')).toBe(false);
	});

	it('rejects a truncated paste', () => {
		expect(looksLikeGeminiKey('AIzaShort')).toBe(false);
	});

	it('rejects an empty string', () => {
		expect(looksLikeGeminiKey('   ')).toBe(false);
	});
});

describe('normalizeKey', () => {
	it('trims surrounding whitespace', () => {
		expect(normalizeKey(`  ${FAKE_KEY}\n`)).toBe(FAKE_KEY);
	});

	it('strips a data-URL prefix a paste may carry', () => {
		expect(normalizeKey(`data:application/json;base64,${FAKE_KEY}`)).toBe(FAKE_KEY);
	});
});

describe('keystore storage policy', () => {
	it('keeps the key in sessionStorage by default', () => {
		writeKey(FAKE_KEY, false);
		expect(session.getItem('geminitts.byok.key')).toBe(FAKE_KEY);
		expect(local.getItem('geminitts.byok.key')).toBeNull();
	});

	it('moves the key to localStorage only when asked', () => {
		writeKey(FAKE_KEY, true);
		expect(local.getItem('geminitts.byok.key')).toBe(FAKE_KEY);
		expect(session.getItem('geminitts.byok.key')).toBeNull();
	});

	// Un-ticking "remember" must not strand the key in localStorage forever.
	it('leaves no copy behind in the other store when the mode changes', () => {
		writeKey(FAKE_KEY, true);
		writeKey(FAKE_KEY, false);
		expect(local.getItem('geminitts.byok.key')).toBeNull();
		expect(session.getItem('geminitts.byok.key')).toBe(FAKE_KEY);
	});

	it('reads the key back from either store', () => {
		writeKey(FAKE_KEY, false);
		expect(readKey()).toBe(FAKE_KEY);
		writeKey(FAKE_KEY, true);
		expect(readKey()).toBe(FAKE_KEY);
	});

	it('forgets the key on clear', () => {
		writeKey(FAKE_KEY, true);
		clearKey();
		expect(readKey()).toBeNull();
		expect(local.getItem('geminitts.byok.key')).toBeNull();
	});

	// Reverting to the server key is the moment the UI says "no key is stored",
	// so that claim has to be true in storage, not just in the label.
	it('clears the key when the provider reverts to server', () => {
		writeKey(FAKE_KEY, true);
		writeMode('server');
		expect(readKey()).toBeNull();
	});

	it('defaults the provider to the server key', () => {
		expect(readMode()).toBe('server');
	});

	it('remembers an explicit byok choice', () => {
		writeMode('byok');
		expect(readMode()).toBe('byok');
	});
});

describe('routeFor', () => {
	// The default path. With no key stored, BYOK is not even in play, so every
	// key-requiring endpoint must stay on the server.
	it('sends key-requiring endpoints to the server by default', () => {
		expect(routeFor('synthesize')).toBe('server');
		expect(routeFor('transcribe')).toBe('server');
	});

	it('uses the browser only when a byok key is both selected and stored', () => {
		writeKey(FAKE_KEY, false);
		expect(routeFor('synthesize')).toBe('server');
		writeMode('byok');
		expect(routeFor('synthesize')).toBe('browser');
	});

	// Selecting byok with no key must not produce a keyless browser call.
	it('falls back to the server when byok is selected but no key is stored', () => {
		writeMode('byok');
		expect(routeFor('transcribe')).toBe('server');
	});

	/**
	 * The security assertions. Phase 0.2 measured that the Live WebSocket can
	 * only be authenticated by a query parameter, so routing it to the browser
	 * would put the user's key in history. `extract` is Node-bound
	 * (mammoth/unpdf). Neither may ever follow the mode, and these tests are
	 * what stop a future refactor from "simplifying" that away.
	 */
	it('never routes live-token to the browser, even under byok', () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		expect(routeFor('live-token')).toBe('always-server');
	});

	it('never routes extract to the browser, even under byok', () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		expect(routeFor('extract')).toBe('always-server');
	});

	it('never routes estimate over the network, under either mode', () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		expect(routeFor('estimate')).toBe('local');
		writeMode('server');
		expect(routeFor('estimate')).toBe('local');
	});
});

describe('byokCovers', () => {
	it('covers tts and stt', () => {
		expect(byokCovers('synthesize')).toBe(true);
		expect(byokCovers('transcribe')).toBe(true);
	});

	it('excludes live, extract and estimate', () => {
		expect(byokCovers('live-token')).toBe(false);
		expect(byokCovers('extract')).toBe(false);
		expect(byokCovers('estimate')).toBe(false);
	});

	it('has a route for every endpoint it describes', () => {
		for (const endpoint of Object.keys(ROUTES)) {
			expect(byokCovers(endpoint as keyof typeof ROUTES)).toBe(ROUTES[endpoint as keyof typeof ROUTES] === 'browser');
		}
	});
});

describe('usingByok', () => {
	it('is false without a key', () => {
		writeMode('byok');
		expect(usingByok()).toBe(false);
	});

	it('is true only with both a mode and a key', () => {
		writeKey(FAKE_KEY, false);
		writeMode('byok');
		expect(usingByok()).toBe(true);
	});
});

describe('request routing', () => {
	it('sends synthesize to our origin on the default path', async () => {
		await request('synthesize', { text: 'Hello.' });
		expect(fetches).toHaveLength(1);
		expect(fetches[0].url).toBe('/api/synthesize');
	});

	it('keeps live-token on our origin under byok', async () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		await request('live-token', { language: 'auto' });
		expect(fetches[0].url).toBe('/api/live-token');
	});

	it('keeps extract on our origin under byok', async () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		await request('extract', { name: 'a.txt', data: 'aGk=' });
		expect(fetches[0].url).toBe('/api/extract');
	});

	// The estimate assertion that matters most: no fetch at all, and the body
	// still parses, because the panels branch on `.json()` either way.
	it('answers estimate locally with no network call', async () => {
		const response = await request('estimate', { text: 'One. Two. Three.' });
		expect(fetches).toHaveLength(0);
		expect(response.ok).toBe(true);
		expect((await response.json()).estimatedCostUsd).toBeGreaterThan(0);
	});

	it('answers estimate locally under byok too', async () => {
		writeKey(FAKE_KEY, true);
		writeMode('byok');
		await request('estimate', { text: 'Hello.' });
		expect(fetches).toHaveLength(0);
	});

	it('rejects an empty estimate rather than quoting zero', async () => {
		const response = await request('estimate', { text: '   ' });
		expect(response.status).toBe(400);
		expect(fetches).toHaveLength(0);
	});
});
