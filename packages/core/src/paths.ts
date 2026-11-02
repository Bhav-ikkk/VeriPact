/**
 * @veripact/core repo-root resolution.
 *
 * The demo server may start from ANY working directory (`npm start` at the
 * root, `node dist/index.js` inside `packages/workbench`, a systemd unit,
 * …), so no package may assume `process.cwd()` is the monorepo root.
 * `resolveRepoRoot()` walks up from this module until it finds the root
 * markers, and every file path in the codebase anchors here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** True when `dir` looks like the VeriPact monorepo root. */
function isRepoRoot(dir: string): boolean {
  if (existsSync(join(dir, 'benchmark', 'scenarios', 'scenarios.json'))) {
    return true;
  }
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
    return pkg.workspaces !== undefined;
  } catch {
    return false;
  }
}

/**
 * Deterministic monorepo root: walk up from this module (covers
 * `packages/<name>/dist` at runtime and `packages/<name>/src` under
 * vitest), then fall back to `process.cwd()` when no markers are found
 * (e.g. installed as a dependency — callers then behave as before).
 */
export function resolveRepoRoot(): string {
  let dir = resolve(__dirname);
  for (let i = 0; i < 12; i += 1) {
    if (isRepoRoot(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  const cwd = process.cwd();
  return isRepoRoot(cwd) ? cwd : cwd;
}

/** Join path segments onto the resolved repo root. */
export function repoPath(...segments: string[]): string {
  return join(resolveRepoRoot(), ...segments);
}
