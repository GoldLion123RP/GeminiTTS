/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Gemini API key. Read server-side only, via `getSecret('GEMINI_API_KEY')`
   * from `astro:env/server` — never `import.meta.env`, and never a `PUBLIC_`
   * prefixed name. Optional because `bun run build` must not fail on a machine
   * that has not created `.env` yet.
   */
  readonly GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
