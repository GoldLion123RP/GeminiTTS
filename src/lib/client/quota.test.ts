import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
	clearSpend,
	pacificDay,
	recordSpend,
	setRememberSpend,
	SPEND_EVENT,
	summariseSpend,
} from './quota';

/**
 * Bun has no `localStorage`, and this module reads and writes both stores
 * unguarded — that is the code under test. So a real `Storage` implementation
 * is installed rather than the module's own accessors being mocked: a stubbed
 * `getItem` would pass while the `JSON.parse` of a hand-edited value, the
 * 200-entry cap, and the migration path all went untested.
 *
 * Fresh stores per test, because `recordSpend` accumulates by design and one
 * test's three requests would otherwise make the next test's expected count
 * wrong — a failure that points at the assertion instead of at the leak.
 */
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
	[key: string]: unknown;
}

let session: MemoryStorage;
let local: MemoryStorage;

/**
 * Bun has no `window`, so a real `EventTarget` stands in for it. A hand-rolled
 * listener registry would have been easier and would have tested the stub
 * rather than `addEventListener` — and the failure this test guards against
 * (a silent no-op broadcast) is exactly the kind that only a genuine
 * EventTarget can catch.
 */
let bus: EventTarget;

beforeEach(() => {
	session = new MemoryStorage();
	local = new MemoryStorage();
	(globalThis as { sessionStorage: Storage }).sessionStorage = session;
	(globalThis as { localStorage: Storage }).localStorage = local;
	bus = new EventTarget();
	(globalThis as { window: EventTarget }).window = bus;
});

afterEach(() => {
	(globalThis as { sessionStorage: Storage }).sessionStorage = session;
	(globalThis as { localStorage: Storage }).localStorage = local;
});

/** A fixed "now" for a day boundary, 2026-09-26T12:00:00Z. */
const NOON = Date.parse('2026-09-26T12:00:00Z');

describe('pacificDay', () => {
	/**
	 * The provider's daily ceiling resets at midnight Pacific — VERIFIED
	 * [ai.google.dev/gemini-api/docs/rate-limits, fetched 2026-09-26] — so the
	 * bucket has to follow that boundary, not the reader's. These three
	 * timestamps are all the same *Pacific* day despite spanning two UTC days,
	 * which is exactly the case a local-date bucket would get wrong.
	 */
	test('buckets by the Pacific day, not the UTC or local day', () => {
		expect(pacificDay(Date.parse('2026-09-26T02:00:00Z'))).toBe('2026-09-25');
		expect(pacificDay(Date.parse('2026-09-26T12:00:00Z'))).toBe('2026-09-26');
		expect(pacificDay(Date.parse('2026-09-26T23:00:00Z'))).toBe('2026-09-26');
	});

	/**
	 * 06:30 UTC on 27 September is still 26 September in Los Angeles (23:30 on
	 * the 26th). A UTC bucket would already have rolled over; a reader in
	 * Kolkata would have rolled over ten hours earlier than the real limit does.
	 */
	test('a late-UTC evening belongs to the previous Pacific day', () => {
		expect(pacificDay(Date.parse('2026-09-27T06:30:00Z'))).toBe('2026-09-26');
	});

	test('returns a sortable YYYY-MM-DD string', () => {
		expect(pacificDay(NOON)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('recordSpend', () => {
	test('counts a recorded request', () => {
		recordSpend('synthesize', 'server', true);
		expect(summariseSpend().today).toBe(1);
	});

	/**
	 * `estimate` is pure local arithmetic — the provider seam calls it without
	 * touching the network. Counting it would inflate every number the meter
	 * shows and spend a `localStorage` write on a keystroke, since the TTS panel
	 * re-estimates on every debounced input.
	 */
	test('ignores the local `estimate` endpoint', () => {
		for (let i = 0; i < 25; i++) recordSpend('estimate', 'server', true);
		expect(summariseSpend().today).toBe(0);
	});

	test('records failures alongside successes, because they are still requests', () => {
		recordSpend('transcribe', 'server', true);
		recordSpend('transcribe', 'server', false);

		const summary = summariseSpend();
		expect(summary.today).toBe(2);
		expect(summary.failed).toBe(1);
	});

	test('keys the count per provider', () => {
		recordSpend('synthesize', 'server', true);
		recordSpend('synthesize', 'byok', true);
		recordSpend('synthesize', 'byok', true);

		const summary = summariseSpend();
		expect(summary.today).toBe(3);
		expect(summary.byok).toBe(2);
	});

	test('drops entries from a previous day rather than counting them', () => {
		// A hand-written yesterday entry. Written directly rather than via
		// `recordSpend`, which always stamps "now" and could not produce one.
		session.setItem(
			'geminitts.quota.log',
			JSON.stringify([
				{ endpoint: 'synthesize', provider: 'server', ok: true, at: Date.parse('2026-09-25T12:00:00Z') },
			]),
		);

		expect(summariseSpend().today).toBe(0);
	});

	test('caps the log so a long-lived tab cannot grow it without bound', () => {
		for (let i = 0; i < 260; i++) recordSpend('synthesize', 'server', true);
		const log = JSON.parse(session.getItem('geminitts.quota.log') ?? '[]');
		expect(log).toHaveLength(200);
		// The cap drops the OLDEST entries, so the total is understated by 60
		// rather than overstated. Erring down is the right direction for a
		// number whose purpose is to warn.
		expect(summariseSpend().today).toBe(200);
	});
});

describe('summariseSpend', () => {
	/**
	 * The log is user-writable — anyone with devtools can edit it — so a
	 * hand-mangled value must read as "no history" rather than crash the panel
	 * that renders it. An unfiltered `JSON.parse` cast would put
	 * `undefined` into `pacificDay(...)`.
	 */
	test('survives a corrupt, non-array, or malformed log', () => {
		for (const corrupt of ['not json', '{"a":1}', 'null', '[1,2,3]', '[{"endpoint":5}]']) {
			session.setItem('geminitts.quota.log', corrupt);
			expect(summariseSpend().today).toBe(0);
		}
	});

	test('an absent log reads as zero, not as an error', () => {
		expect(summariseSpend()).toMatchObject({ today: 0, byok: 0, failed: 0, remembered: false });
	});
});

describe('setRememberSpend', () => {
	test('migrates the existing log rather than clearing it', () => {
		recordSpend('synthesize', 'server', true);
		recordSpend('transcribe', 'server', true);

		setRememberSpend(true);

		expect(summariseSpend().today).toBe(2);
		expect(summariseSpend().remembered).toBe(true);
		expect(session.getItem('geminitts.quota.log')).toBeNull();
	});

	test('unticking moves the log back rather than stranding it', () => {
		recordSpend('synthesize', 'server', true);
		setRememberSpend(true);
		setRememberSpend(false);

		expect(summariseSpend().today).toBe(1);
		expect(summariseSpend().remembered).toBe(false);
		expect(localStorage.getItem('geminitts.quota.log')).toBeNull();
	});
});

describe('clearSpend', () => {
	test('forgets the log and the remember flag in both stores', () => {
		recordSpend('synthesize', 'server', true);
		setRememberSpend(true);

		clearSpend();

		expect(summariseSpend()).toMatchObject({ today: 0, remembered: false });
		expect(localStorage.getItem('geminitts.quota.log')).toBeNull();
		expect(session.getItem('geminitts.quota.log')).toBeNull();
		expect(localStorage.getItem('geminitts.quota.remember')).toBeNull();
	});
});

describe('announcements', () => {
	/**
	 * The meter redraws from this event rather than polling. If it stopped
	 * firing, the count would still be right on a manual refresh and wrong
	 * during use — a bug with no other symptom.
	 */
	test('recording dispatches the spend event so open meters redraw', () => {
		let heard = 0;
		const listener = () => {
			heard++;
		};
		bus.addEventListener(SPEND_EVENT, listener);
		try {
			recordSpend('synthesize', 'server', true);
		} finally {
			bus.removeEventListener(SPEND_EVENT, listener);
		}
		expect(heard).toBe(1);
	});

	test('an ignored endpoint announces nothing', () => {
		let heard = 0;
		const listener = () => {
			heard++;
		};
		bus.addEventListener(SPEND_EVENT, listener);
		try {
			recordSpend('estimate', 'server', true);
		} finally {
			bus.removeEventListener(SPEND_EVENT, listener);
		}
		expect(heard).toBe(0);
	});
});
