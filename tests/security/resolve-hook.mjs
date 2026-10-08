// tests/security/resolve-hook.mjs
// Module resolution hook for the persistent security suite.
//
// WHY THIS EXISTS
// The suite runs the REAL server/route/repository TypeScript directly in Node via
// `node --experimental-strip-types`. Node strips the TS types but does NOT understand two things the
// Next.js bundler normally handles:
//   1. the `@/` path alias (tsconfig "paths": { "@/*": ["./*"] }) used by the route handlers, and
//   2. extensionless relative imports (e.g. `./index`, `../auth/protect`) that actually resolve to
//      `.ts` files on disk.
// This loader resolves both to concrete `file://.../*.ts` URLs so the untouched production source can
// be imported and exercised exactly as it ships. It changes NO production code — it is test-only glue.
//
// This mirrors the extensionless/`@/`-alias mapping the throwaway Task 13/14/16 harnesses used; it is
// now persisted here so `npm run test:security` is repeatable.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { existsSync, statSync } from "node:fs";
import { register } from "node:module";

// Self-register as a module customization hook when loaded via `node --import`. The exported `resolve`
// below runs in the hooks thread. Registering here lets a single `--import ./resolve-hook.mjs` flag
// install the loader (plain `--import` of a module that merely EXPORTS resolve does NOT install it).
// Guard against infinite re-registration: only register the first time this module is evaluated in the
// main thread (the hooks-thread copy sets the env marker check off).
if (!process.env.__SEC_HOOK_REGISTERED) {
  process.env.__SEC_HOOK_REGISTERED = "1";
  register(import.meta.url);
}

// Repo root = two levels up from tests/security/.
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TS_EXTS = [".ts", ".tsx"];

/** Try a base path with the TS extensions and index files; return a file:// URL or null. */
function tryResolveTs(basePathNoExt) {
  // Direct file with a TS extension.
  for (const ext of TS_EXTS) {
    const candidate = basePathNoExt + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  // Directory import -> index.ts / index.tsx.
  if (existsSync(basePathNoExt) && statSync(basePathNoExt).isDirectory()) {
    for (const ext of TS_EXTS) {
      const candidate = resolvePath(basePathNoExt, "index" + ext);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return pathToFileURL(candidate).href;
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // 1) `@/...` alias -> repo-root-relative, then resolve to a .ts/.tsx file.
  if (specifier.startsWith("@/")) {
    const base = resolvePath(ROOT, specifier.slice(2));
    const url = tryResolveTs(base) ?? pathToFileURL(base).href;
    return { url, shortCircuit: true };
  }

  // 2) Relative imports WITHOUT an explicit extension that resolve to a .ts/.tsx file on disk.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = resolvePath(dirname(parentPath), specifier);
    const url = tryResolveTs(base);
    if (url) return { url, shortCircuit: true };
  }

  // Everything else (node:*, bare packages, already-extensioned paths) -> default resolution.
  return nextResolve(specifier, context);
}
