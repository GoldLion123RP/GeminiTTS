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

/**
 * `MAX_ENTRIES` and `LOG_KEY` are module-private in `quota.ts`. Spelled out here
 * rather than exported, because the cap is the thing under test and a test that
 * reads `expect(log).toHaveLength(MAX_ENTRIES)` proves nothing about which
 * number it is — the duplication is the assertion.
 */
const CAP = 200;

/**
 * How many requests to push past a *full* log. Ten, not two hundred and sixty:
 * see the note on the cap test for why the count is not what proves anything.
 */
const OVERFLOW = 10;

/** Endpoints used only as markers, so a dropped entry is identifiable. */
const DROPPED_MARKER = 'live-token';
const KEPT_MARKER = 'extract';

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

	/**
	 * The cap is the whole assertion, and the boundary is where it lives, so the
	 * log is seeded already full and then overflowed. What is being checked is
	 * the *invariant* — however many requests arrive, the stored log is at most
	 * `CAP` long and the oldest are what go — and a seeded fixture tests that at
	 * the point where truncation actually happens, where a 260-call loop tested
	 * it 200 entries short of the only interesting state.
	 *
	 * The old loop was also the file's entire cost, and it was not the
	 * serialisation the plan blamed. Measured on this machine: the quadratic
	 * `JSON.parse`/`JSON.stringify` of a 200-entry log across 260 calls is 23ms.
	 * The 10.6s came from `read()` calling `pacificDay()` once per entry, and
	 * `pacificDay` built a fresh `Intl.DateTimeFormat` on every single call —
	 * ~0.31ms each, ~34,000 of them. Seeding removes ~98% of those calls and
	 * keeps the coverage, so the file no longer needs a raised timeout to pass
	 * on a quiet machine.
	 *
	 * The per-entry formatter cost was a production characteristic, and it is
	 * now fixed: `pacificDay` builds one module-level formatter (D15). Re-measured
	 * against a full 200-entry log, one `recordSpend` went from 201 constructions
	 * to 0, and the 201-call path from ~30ms to ~0.5ms. The measurement is the
	 * reason this comment is worth keeping: it named a cost, and the fix was
	 * three lines.
	 */
	test('caps the log so a long-lived tab cannot grow it without bound', () => {
		// `recordSpend` always stamps "now" and could not produce a full log
		// cheaply, so the fixture is written directly — the same approach the
		// previous-day test already uses, and the reason this file installs a
		// real `Storage` rather than mocking the accessors.
		const at = Date.now();
		const seed = Array.from({ length: CAP }, () => ({
			endpoint: 'synthesize',
			provider: 'server',
			ok: true,
			at,
		}));
		// Two markers bracket the boundary: the oldest entry must be gone, and
		// the entry that is about to become the oldest must be exactly at the
		// head. That pins the cut-off to "dropped `OVERFLOW`, no more" instead
		// of merely "something was dropped".
		seed[0] = { ...seed[0], endpoint: DROPPED_MARKER };
		seed[OVERFLOW] = { ...seed[OVERFLOW], endpoint: KEPT_MARKER };
		session.setItem('geminitts.quota.log', JSON.stringify(seed));

		for (let i = 0; i < OVERFLOW; i++) recordSpend('transcribe', 'byok', true);

		const log = JSON.parse(session.getItem('geminitts.quota.log') ?? '[]');
		expect(log).toHaveLength(CAP);
		expect(log[0].endpoint).toBe(KEPT_MARKER);
		expect(log.some((entry: { endpoint: string }) => entry.endpoint === DROPPED_MARKER)).toBe(
			false,
		);
		// The tail is kept, not the head: the newest entries are the ones a user
		// reading a daily meter cares about.
		expect(log[log.length - 1]).toMatchObject({ endpoint: 'transcribe', provider: 'byok' });
		// 200 seeded plus `OVERFLOW` recorded, so the cap drops the OLDEST and
		// the total is understated by `OVERFLOW` rather than overstated.
		// Erring down is the right direction for a number whose purpose is to
		// warn.
		expect(summariseSpend().today).toBe(CAP);
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
