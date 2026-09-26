// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

/**
 * Two deployment targets, one source tree.
 *
 *   default            `output: 'server'` on the node adapter — the real
 *                      product. `bun run build && bun run start`.
 *
 *   PAGES_TARGET=pages `output: 'static'` with the same adapter retained. Pages
 *                      serves files, so the three pages are prerendered into
 *                      `dist/client` and the six `prerender = false` API routes
 *                      are still emitted into `dist/server` (which Pages never
 *                      uploads). What runs on Pages is the BYOK path:
 *                      `src/lib/client/gemini-direct.ts` calls Google from the
 *                      browser, so the demo needs no server secret at all.
 *
 * `base` is non-empty only for Pages. A repository site is served from
 * `/GeminiTTS/`, not `/`, so every internal link must carry that prefix —
 * `src/lib/base.ts` is the one place that knows it.
 *
 * `output` is read from the environment rather than exported as a per-route
 * value on purpose: Astro 5 removed dynamic `prerender` exports, so the switch
 * cannot live in `src/pages/**`.
 */
const PAGES = process.env.PAGES_TARGET === 'pages';

// https://astro.build/config
export default defineConfig({
	// Server output is required for the node deployment: the Gemini calls in
	// Phase 2/3 must never run in the browser, and GEMINI_API_KEY is a
	// server-only secret.
	output: PAGES ? 'static' : 'server',
	...(PAGES ? { base: '/GeminiTTS/', site: 'https://goldlion123rp.github.io' } : {}),
	adapter: node({ mode: 'standalone' }),
	vite: {
		plugins: [tailwindcss()],
	},
	// Font stacks are transcribed from DESIGN.md (typography, L292-316).
	// Exactly two faces — the "no third face" ruling in the plan §2.4
	// Conflict B: Bengali and Devanagari come from browser system fallback.
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Geist',
			cssVariable: '--font-geist',
			weights: [400, 500, 600],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['Arial', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Geist Mono',
			cssVariable: '--font-geist-mono',
			weights: [500],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
		},
	],
});
