import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { planCreationAttempt } from "../src/components/plan-creation-attempt";

it("retains a creation intent for exact retries including normalized whitespace", () => {
  const previous = {
    commandId: randomUUID(),
    date: "2026-10-01",
    label: "Salida 2",
  };
  expect(
    planCreationAttempt(
      previous,
      { date: " 2026-10-01 ", label: " Salida 2 " },
      () => {
        throw new Error("should retain identity");
      },
    ),
  ).toBe(previous);
});
it("creates a new identity for each new dialog and each changed payload", () => {
  const input = { date: "2026-10-01", label: "Salida 2" };
  const one = planCreationAttempt(null, input, randomUUID);
  const another = planCreationAttempt(null, input, randomUUID);
  expect(another.commandId).not.toBe(one.commandId);
  for (const changed of [
    { ...input, date: "2026-10-02" },
    { ...input, label: "Salida 3" },
  ]) {
    const next = planCreationAttempt(one, changed, randomUUID);
    expect(next.commandId).not.toBe(one.commandId);
    expect(next).toMatchObject(changed);
  }
});
