import { describe, expect, it, vi } from "vitest";

import { createRefetchScheduler } from "./reconciliation";

describe("group Broadcast reconciliation", () => {
  it("coalesces a duplicated event into one authoritative refetch", async () => {
    const refetch = vi.fn();
    const schedule = createRefetchScheduler(refetch);

    schedule();
    schedule();
    await Promise.resolve();

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
