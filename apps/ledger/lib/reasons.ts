/** Refusal reasons in plain English, keyed by the policy program's stable codes. */
export const REASON: Record<string, string> = {
  SELECTOR_NOT_ALLOWED: "This kind of transaction is not allowed by the vault's rules.",
  RECIPIENT_NOT_ALLOWED: "The recipient is not on the approved list.",
  TARGET_NOT_ALLOWED: "The contract it tried to call is not approved.",
  SPENDER_NOT_ALLOWED: "It tried to approve spending by an unapproved contract.",
  TOKEN_NOT_ALLOWED: "It tried to move a token the vault does not allow.",
  TOKEN_OUT_NOT_ALLOWED: "It tried to swap into a token the vault does not allow.",
  NO_MIN_OUT: "The swap had no price protection.",
  SWAP_RECIPIENT_NOT_VAULT: "The swap would have sent the output somewhere other than the vault.",
  UNLIMITED_APPROVE: "The approval was larger than the daily limit.",
  EXCEEDS_PER_TX: "Above the per-transaction limit.",
  EXCEEDS_PER_DAY: "Above the daily limit.",
  VALUE_NOT_ZERO: "It tried to send ETH, which the vault does not allow.",
  SELF_CALL: "It tried to change the vault's own settings.",
  UNSUPPORTED_VERSION: "The vault's rules use a version this agent does not support.",
  CALLDATA_TOO_SHORT: "The transaction data was malformed.",
  UNKNOWN_SELECTOR: "This kind of transaction is not supported.",
  BAD_CALLDATA_LENGTH: "The transaction data was malformed.",
  BAD_CALLDATA_ENCODING: "The transaction data was malformed.",
};

export const reasonFor = (code: string | null | undefined) =>
  REASON[(code ?? "").split("→")[0]!.trim()] ?? "Rule check failed.";
