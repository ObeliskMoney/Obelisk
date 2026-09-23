/**
 * The message the vault owner's wallet signs to instruct the agent.
 * An identical copy lives in apps/ledger/lib/auth.ts (frontend); change both together.
 */
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

export interface SignedRequest {
  vault: string;
  ts: number;
  signature: `0x${string}`;
}
