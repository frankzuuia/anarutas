import { describe, expect, it } from "vitest";
import { compareCollectionReceipts } from "../src/core/collection-receipt-order";

describe("settlement receipt order", () => {
  const first = { recordedAt: "2026-10-01T16:00:00.001Z", id: "b" };
  const second = { recordedAt: "2026-10-01T16:00:00.002Z", id: "a" };
  it("appends new collections even when their route position or id is earlier", () => {
    expect(compareCollectionReceipts(first, second)).toBeLessThan(0);
    expect(compareCollectionReceipts(second, first)).toBeGreaterThan(0);
    expect([second, first].sort(compareCollectionReceipts)).toEqual([
      first,
      second,
    ]);
  });
  it("keeps identical instants deterministic across reloads and timezone notation", () => {
    const tied = { recordedAt: "2026-10-01T10:00:00.001-06:00", id: "a" };
    expect(compareCollectionReceipts(tied, first)).toBeLessThan(0);
    expect(compareCollectionReceipts(first, tied)).toBeGreaterThan(0);
    expect(compareCollectionReceipts(first, { ...first })).toBe(0);
  });
});
