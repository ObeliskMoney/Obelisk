import { createHash } from "node:crypto";
import { DstackClient } from "@phala/dstack-sdk";
import { toViemAccountSecure } from "@phala/dstack-sdk/viem";
import { encodePacked, hexToBytes, keccak256, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface Attestation {
  kind: "tdx" | "dev";
  /**
   * true = the quote comes from the dstack simulator (no TDX hardware). The agent key is still derived by dstack,
   * but root on the machine can read it. This must be shown honestly in the API and on the website.
   */
  simulated?: boolean;
  /** TDX quote (hex). Empty in dev mode. */
  quote?: Hex;
  eventLog?: string;
  /** report_data = keccak256("obelisk-agent-v1", agentAddress), padded to 64 bytes. */
  reportData: Hex;
  /** sha256(appCompose) = the dstack compose hash, recorded onchain as codeMeasurement. */
  codeMeasurement: Hex;
  /** The hashed app-compose content, so the owner can audit the agent's image and configuration. */
  appCompose?: string;
  appId?: string;
}

export interface AgentIdentity {
  account: LocalAccount;
  attestation: Attestation;
}

export function reportDataFor(address: Hex): Hex {
  return keccak256(encodePacked(["string", "address"], ["obelisk-agent-v1", address]));
}

/**
 * The agent key is born inside the TEE: dstack derives it from the app identity (compose hash)
 * and it never leaves the enclave. Outside a TEE (development), AGENT_DEV_PRIVATE_KEY is used
 * and the attestation is marked "dev"; a real AgentRegistry should only accept "tdx".
 */
export async function loadIdentity(): Promise<AgentIdentity> {
  let client: DstackClient | undefined;
  try {
    client = new DstackClient(); // throws if there is no dstack socket or DSTACK_SIMULATOR_ENDPOINT
  } catch {
    client = undefined;
  }
  if (client && (await client.isReachable().catch(() => false))) {
    const account = toViemAccountSecure(await client.getKey("obelisk/agent", "signing")) as LocalAccount;
    const reportData = reportDataFor(account.address);
    const quote = await client.getQuote(hexToBytes(reportData)); // 32 raw bytes, not a hex string
    const info = await client.info();
    return {
      account,
      attestation: {
        kind: "tdx",
        simulated: Boolean(process.env.DSTACK_SIMULATOR_ENDPOINT),
        quote: quote.quote as Hex,
        eventLog: quote.event_log,
        reportData,
        // dstack definition: compose_hash = sha256(app_compose), extended into RTMR3.
        // Computed here because the simulator returns a fixed compose_hash from its example quote.
        codeMeasurement: `0x${createHash("sha256").update(info.tcb_info.app_compose).digest("hex")}` as Hex,
        appCompose: info.tcb_info.app_compose,
        appId: info.app_id,
      },
    };
  }

  const pk = process.env.AGENT_DEV_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("dstack is unreachable and AGENT_DEV_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(pk);
  return {
    account,
    attestation: {
      kind: "dev",
      reportData: reportDataFor(account.address),
      codeMeasurement: keccak256(encodePacked(["string"], ["obelisk-agent-dev"])),
    },
  };
}
