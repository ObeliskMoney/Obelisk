/** Identical copy of packages/shared/src/auth.ts; change both together. */
export type AuthAction = "task" | "job:create" | "job:delete" | "vault:register";

export function authMessage(p: { vault: string; action: AuthAction; payload: string; ts: number }): string {
  return [
    "Obelisk agent command",
    `vault: ${p.vault.toLowerCase()}`,
    `action: ${p.action}`,
    `content: ${p.payload}`,
    `time: ${p.ts}`,
  ].join("\n");
}
