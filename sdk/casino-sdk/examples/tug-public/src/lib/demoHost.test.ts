import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoHost } from "./demoHost";
import {
  EMPTY_HEX,
  encodeCashoutAction,
  encodeHoldAction,
  INTENSITY_EASE,
} from "./tug";

describe("standalone demo host safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects duplicate holds and credits a settled payout only once", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0); // accepted Ease result
        return bytes;
      },
    });
    const demo = createDemoHost();
    const wager = 10n ** 18n;
    const opened = await demo.hostApi.openSession({
      wager: wager.toString(),
      gameData: EMPTY_HEX,
      randomnessRequestData: EMPTY_HEX,
    });
    const sessionId = opened.sessionKey.split(":")[1];
    const first = demo.hostApi.submitAction({
      sessionId,
      actionData: encodeHoldAction(INTENSITY_EASE),
      randomnessRequestData: EMPTY_HEX,
    });
    await expect(
      demo.hostApi.submitAction({
        sessionId,
        actionData: encodeHoldAction(INTENSITY_EASE),
        randomnessRequestData: EMPTY_HEX,
      }),
    ).rejects.toThrow(/resolving/);
    await first;
    await demo.hostApi.submitAction({
      sessionId,
      actionData: encodeCashoutAction(),
      randomnessRequestData: EMPTY_HEX,
    });
    const before = BigInt(demo.getSnapshot().balances.smartVaultBalance!);
    await demo.hostApi.revealOutcome({ sessionId });
    const once = BigInt(demo.getSnapshot().balances.smartVaultBalance!);
    await demo.hostApi.revealOutcome({ sessionId });
    const twice = BigInt(demo.getSnapshot().balances.smartVaultBalance!);
    expect(once).toBeGreaterThan(before);
    expect(twice).toBe(once);
  });
});
