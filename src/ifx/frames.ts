import { randomInt } from "node:crypto";

import { DEFAULT_TAPE_LEN, FrameScratch } from "@ifx-run/sdk";
import { PublicKey } from "@solana/web3.js";

/** Pick a configured public Frame and build a scratch planner (no on-chain decode). */
export function scratchForBuild(
  publicFrames: string[],
  programId: string
): { scratch: FrameScratch; framePubkey: string } {
  const framePubkey = publicFrames[randomInt(publicFrames.length)]!;
  const scratch = FrameScratch.forPublicFrame({
    framePubkey: new PublicKey(framePubkey),
    programId: new PublicKey(programId),
    tapeLen: DEFAULT_TAPE_LEN,
  });
  return { scratch, framePubkey };
}
