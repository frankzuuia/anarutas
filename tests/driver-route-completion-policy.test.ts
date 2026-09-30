import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertCompletionOrders, routeCompletionInput } from "../src/core/driver-route-completion-policy";

it("allows exactly the complete published order set, only delivered or rescheduled", () => {
  const states = ["open", "delivered", "closed_pending", "rejected", "rescheduled", "unknown"];
  for (const first of states) for (const second of states) {
    const run = () => assertCompletionOrders(["a", "b"], [{ shipment_id: "b", status: second }, { shipment_id: "a", status: first }]);
    if ([first, second].every(status => ["delivered", "rescheduled"].includes(status))) expect(run).not.toThrow();
    else expect(run).toThrow(expect.objectContaining({ code: "ROUTE_HAS_PENDING_ORDERS" }));
  }
  for (const [expected, actual] of [[[], []], [["a", "a"], ["a", "a"]], [["a", "b"], ["a"]],
    [["a"], ["a", "b"]], [["a"], ["a", "a"]], [["a", "b"], ["a", "a"]], [["a", "b"], ["a", "c"]]] as [string[], string[]][])
    expect(() => assertCompletionOrders(expected, actual.map(shipment_id => ({ shipment_id, status: "delivered" }))))
      .toThrow(expect.objectContaining({ code: "ROUTE_HAS_PENDING_ORDERS" }));
});

it("requires explicit confirmation, real GPS metadata and every versioned identity", () => {
  const input = { confirmed: true, commandId: randomUUID(), executionId: randomUUID(), publicationRevision: 1,
    executionRevision: 1, depotVersion: 1, policyVersion: 1,
    sample: { latitude: 20, longitude: -103, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: "2026-09-29T12:00:00Z", mock: false } };
  expect(routeCompletionInput(input)).toMatchObject({ commandId: input.commandId, sample: { capturedAt: "2026-09-29T12:00:00.000Z" } });
  for (const confirmed of [undefined, false, "true", 1]) expect(() => routeCompletionInput({ ...input, confirmed }))
    .toThrow(expect.objectContaining({ code: "ROUTE_COMPLETION_CONFIRMATION_REQUIRED", status: 400 }));
  for (const key of ["commandId", "executionId", "publicationRevision", "executionRevision", "depotVersion", "policyVersion", "sample"])
    expect(() => routeCompletionInput({ ...input, [key]: undefined })).toThrow();
  for (const key of ["publicationRevision", "executionRevision", "depotVersion", "policyVersion"])
    for (const value of [0, -1, 1.5, "1"]) expect(() => routeCompletionInput({ ...input, [key]: value })).toThrow();
  expect(() => routeCompletionInput({ ...input, sample: { ...input.sample, mock: true } })).toThrow(expect.objectContaining({ code: "LOCATION_UNTRUSTED" }));
});
