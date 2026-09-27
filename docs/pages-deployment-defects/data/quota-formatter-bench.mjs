// Q.2 measurement: the 200-entry recordSpend path, before vs after the
// formatter hoist. Two shapes of the same loop, one per implementation, so the
// number is attributable to the formatter and not to the harness.
const OPTS = {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

function before(at = Date.now()) {
  const f = new Intl.DateTimeFormat('en-CA', OPTS);
  return f.format(new Date(at));
}

let cached = null;
function after(at = Date.now()) {
  if (cached === null) cached = new Intl.DateTimeFormat('en-CA', OPTS);
  return cached.format(new Date(at));
}

const CAP = 200;
const now = Date.now();
const log = Array.from({ length: CAP }, (_, i) => now - i * 60_000);

function oneRecordSpend(pacificDay) {
  let kept = 0;
  const today = pacificDay();
  for (const entry of log) if (pacificDay(entry.at) === today) kept += 1;
  return kept;
}

function bench(label, pacificDay) {
  for (let i = 0; i < 3; i += 1) oneRecordSpend(pacificDay); // warm up
  const runs = 5;
  const t0 = performance.now();
  for (let i = 0; i < runs; i += 1) oneRecordSpend(pacificDay);
  const ms = (performance.now() - t0) / runs;
  console.log(`${label.padEnd(34)} ${ms.toFixed(2)} ms  (${CAP + 1} format calls)`);
  return ms;
}

const b = bench('per-call Intl (before)', before);
const a = bench('hoisted Intl (after)', after);
console.log(`\ncollapse factor: ${(b / a).toFixed(0)}x`);
