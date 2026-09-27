/**
 * The one build-time fact the client needs: does this bundle have a server?
 *
 * WHY IT IS NOT A PROBE
 *
 * The build already knows. `astro.config.mjs` reads `PAGES_TARGET` and flips
 * `output` to `'static'` with a non-empty `base` for the GitHub Pages target;
 * everything else is `output: 'server'` on the node adapter. So "is there a
 * server process behind this deployment" is settled when the bundle is written,
 * and re-deriving it at request time is strictly worse: it costs a round trip
 * and it produces the answer as a user-facing error, which is the shape of the
 * bug this module exists to remove.
 *
 * Before this, a first-time visitor on the static demo was defaulted to the
 * server provider — the one provider that provably cannot work there — and
 * discovered it by typing text, waiting, and reading a 404 explained back to
 * them. The build-time fact was discarded and reconstructed from a failure.
 *
 * THE COUPLING, STATED PLAINLY
 *
 * `BASE_URL` is non-empty if and only if this project is deployed to a
 * sub-path, and the only sub-path deployment in `astro.config.mjs` is the static
 * Pages target. That "if and only if" is the whole mechanism, so it is
 * asserted in `capability.test.ts` against the config file itself — a future
 * base path on a *server* build would silently point every page's default
 * provider at a host that is not there, and nothing else in the toolchain would
 * notice.
 *
 * NOT A SERVER MODULE. No `astro:env/server`, no `@google/genai`, no Node
 * built-ins, so it is importable from a browser bundle, from an SSR pass, and
 * from a plain `bun test` — the same constraint `gemini/models.ts` and
 * `gemini/classify.ts` are written under.
 */

/**
 * True when this bundle was built for a host that runs a server process.
 *
 * The `base` parameter is the seam, not decoration: it is what lets a unit test
 * assert the static case without rebuilding the project, and it keeps the
 * decision a pure function of one string.
 */
export function serverAvailable(base: string = import.meta.env.BASE_URL ?? '/'): boolean {
	// Both spellings are "mounted at the domain root". Astro emits `/` for an
	// unset `base` and `''` for one that is configured empty, and a build that
	// somehow produced neither is treated as root rather than as static: the
	// failure mode of guessing wrong in the other direction is a visitor who
	// cannot use the app at all.
	return base === '/' || base === '';
}
