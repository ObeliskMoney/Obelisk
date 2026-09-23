import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Load `.env` from the monorepo root (no dotenv dependency). Existing env vars are not overwritten. */
export function loadEnv(start = process.cwd()): void {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const f = join(dir, ".env");
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
      }
      return;
    }
    dir = dirname(dir);
  }
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`env ${name} is not set`);
  return v;
}
