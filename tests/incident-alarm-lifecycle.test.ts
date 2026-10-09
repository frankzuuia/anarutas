import { expect, it } from "vitest";
import {
  ownsAlarmReservation,
  retainedAlarmActivation,
} from "../src/core/incident-board-policy";

it("preserves activated audio only in the same installation/account with a running context", () => {
  const input = {
    enabled: true,
    previousScope: "installation:admin-a",
    nextScope: "installation:admin-a",
    audioState: "running" as const,
  };
  expect(retainedAlarmActivation(input)).toBe(true);
  expect(retainedAlarmActivation({ ...input, enabled: false })).toBe(false);
  expect(retainedAlarmActivation({ ...input, previousScope: null })).toBe(
    false,
  );
  expect(
    retainedAlarmActivation({ ...input, nextScope: "installation:admin-b" }),
  ).toBe(false);
  expect(
    retainedAlarmActivation({
      ...input,
      nextScope: "other-installation:admin-a",
    }),
  ).toBe(false);
  for (const audioState of ["suspended", "closed", null] as const)
    expect(retainedAlarmActivation({ ...input, audioState })).toBe(false);
});

it("releases only its own reservation, never an absent or replacement burst", () => {
  expect(ownsAlarmReservation("1791512400000", "1791512400000")).toBe(true);
  expect(ownsAlarmReservation(null, "1791512400000")).toBe(false);
  expect(ownsAlarmReservation("1791512405000", "1791512400000")).toBe(false);
});
