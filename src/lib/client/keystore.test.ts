import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { clearKey, normalizeKey, readKey, readMode, writeKey, writeMode } from './keystore';

/**
 * Storage-policy and provider-default tests for the keystore.
 *
 * The storage stubbing below is not optional decoration. `keystore.ts` touches
 * `sessionStorage` and `localStorage` through a `try` that returns `null`, so
 * without a stub every call in this file would quietly take the "no storage"
 * branch and pass for the wrong reason — or, on a runner that defines neither
 * global, throw a bare `ReferenceError` that reads like a test bug.
 */

/** Assembled at runtime so `bun run check:secrets` never sees a key-shaped literal. */
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

const realSession = globalThis.sessionStorage;
const realLocal = globalThis.localStorage;

beforeEach(() => {
  session = new MemoryStorage();
  local = new MemoryStorage();
  (globalThis as { sessionStorage: Storage }).sessionStorage = session;
  (globalThis as { localStorage: Storage }).localStorage = local;
});

afterEach(() => {
  (globalThis as { sessionStorage: Storage }).sessionStorage = realSession;
  (globalThis as { localStorage: Storage }).localStorage = realLocal;
});

describe('readMode', () => {
  /**
   * The regression this file exists for. With no stored choice on the static
   * Pages deployment there is no server process at all, so `'server'` sends the
   * first request a visitor ever makes to a GitHub 404. Defaulting to the
   * provider that can work is the whole fix.
   */
  it('defaults to byok on a build with no server behind it', () => {
    expect(readMode(false)).toBe('byok');
  });

  // The node build is the real product and must not change behaviour.
  it('defaults to server when a server is present', () => {
    expect(readMode(true)).toBe('server');
  });

  // An explicit choice outranks the default even when it is the one that cannot
  // work here: the app may warn, but overwriting what the user picked makes the
  // preference model a lie and loses the setting on the next render.
  it('honours an explicit server choice even with no server present', () => {
    writeMode('server');
    expect(readMode(false)).toBe('server');
  });

  // The mirror image, and the common case: a user who chose BYOK on the node
  // build keeps it, and keeps it even on a future serverless deployment.
  it('honours an explicit byok choice when a server is present', () => {
    writeMode('byok');
    expect(readMode(true)).toBe('byok');
  });

  // A key sitting in storage is not a mode. Letting presence imply byok would
  // make the transport switch on its own and leave the trust model invisible.
  it('does not infer byok from a stored key alone', () => {
    writeKey(FAKE_KEY, true);
    expect(readMode(true)).toBe('server');
    expect(readMode(false)).toBe('byok');
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
    expect(session.getItem('geminitts.byok.key')).toBeNull();
  });

  // Reverting to the server key is the moment the UI says "no key is stored",
  // so that claim has to be true in storage, not just in the label.
  it('clears the key when the provider reverts to server', () => {
    writeKey(FAKE_KEY, true);
    writeMode('server');
    expect(readKey()).toBeNull();
  });
});
