import { describe, expect, it } from "vitest";
import { operationalPhone } from "../src/core/driver-customer-phone";
import { serviceAction, serviceNote, serviceTransition, type DriverOrderStatus, type DriverServiceKind } from "../src/core/driver-service-policy";

describe("per-order service policy", () => {
  const statuses: DriverOrderStatus[] = ["open", "closed_pending", "rejected", "rescheduled", "delivered"];
  const actions: DriverServiceKind[] = ["reject", "reschedule", "deliver"];
  const expected = { open: ["reject", "deliver"], closed_pending: actions, rejected: ["deliver"], rescheduled: [], delivered: [] };
  for (const status of statuses) for (const action of actions) it(`${status} / ${action}`, () => {
    if ((expected[status] as string[]).includes(action)) expect(serviceTransition(status, action))
      .toBe({ reject: "rejected", reschedule: "rescheduled", deliver: "delivered" }[action]);
    else expect(() => serviceTransition(status, action)).toThrow("ORDER_STATE_CONFLICT");
  });
  it("validates reasons and notes without introducing a reschedule date", () => {
    expect(serviceAction({ kind: "reschedule", note: "  Llamar primero  " })).toEqual({ kind: "reschedule", note: "Llamar primero", reason: null });
    for (const reasonCode of ["poor_quality", "late_arrival", "other"]) expect(serviceAction({ kind: "reject", reasonCode, note: "Motivo" }).reason).toBe(reasonCode);
    for (const raw of [{}, { kind: "x" }, { kind: "reject" }, { kind: "reject", reasonCode: "other", note: " " },
      { kind: "reject", reasonCode: "unknown" }, { kind: "deliver", reasonCode: "other" },
      ...["date", "serviceDate", "scheduledAt"].map(key => ({ kind: "reschedule", [key]: "2027-01-01" }))])
      expect(() => serviceAction(raw)).toThrow();
    expect(serviceAction({ kind: "deliver", reasonCode: null }).reason).toBeNull();
    expect(serviceAction({ kind: "reject", reasonCode: "poor_quality" }).note).toBeNull();
    expect(serviceAction({ kind: "reject", reasonCode: "late_arrival" }).note).toBeNull();
    expect(() => serviceAction({ kind: "bad" })).toThrow("INVALID_SERVICE_ACTION");
    expect(() => serviceAction({ kind: "reschedule", date: "tomorrow" })).toThrow("RESCHEDULE_HAS_NO_DATE");
    expect(() => serviceAction({ kind: "reject", reasonCode: "bad" })).toThrow("INVALID_REJECTION_REASON");
    expect(() => serviceAction({ kind: "deliver", reasonCode: "other" })).toThrow("INVALID_REJECTION_REASON");
    expect(() => serviceAction({ kind: "reject", reasonCode: "other" })).toThrow("REJECTION_NOTE_REQUIRED");
    expect(serviceNote(undefined)).toBeNull(); expect(serviceNote(null)).toBeNull(); expect(serviceNote(" ")).toBeNull();
    expect(serviceNote("a".repeat(2000))).toHaveLength(2000);
    expect(serviceNote("😀".repeat(2000))).toHaveLength(4000);
    for (const note of [42, {}, [], "a".repeat(2001)]) expect(() => serviceNote(note)).toThrow("INVALID_SERVICE_NOTE");
  });
  it("accepts only dialable operational contacts", () => {
    expect(operationalPhone(" +52 (33) 9000-2851 ")).toBe("+523390002851");
    expect(operationalPhone("3312345678")).toBe("3312345678");
    expect(operationalPhone("123.4567")).toBe("1234567");
    for (const invalid of [null, "", "12", "x".repeat(81), "1".repeat(16), "tel:3312345678", "33+12345678", "*1234567890#"])
      expect(() => operationalPhone(invalid)).toThrow("CUSTOMER_PHONE_INVALID");
  });
});
