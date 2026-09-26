import { AppError } from "./errors";

export type DriverOrderStatus = "open" | "closed_pending" | "rejected" | "rescheduled" | "delivered";
export type DriverServiceKind = "reject" | "reschedule" | "deliver";
export type RejectionReason = "poor_quality" | "late_arrival" | "other";

export function retryOrderTransition(status: DriverOrderStatus): DriverOrderStatus {
  if (status !== "rescheduled") throw new AppError("ORDER_STATE_CONFLICT", 409);
  return "open";
}

export function serviceNote(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Array.from(value).length > 2000) throw new AppError("INVALID_SERVICE_NOTE");
  return value.trim() || null;
}

export function serviceAction(raw: Record<string, unknown>): { kind: DriverServiceKind; reason: RejectionReason | null; note: string | null } {
  const kind = raw.kind;
  if (kind !== "reject" && kind !== "reschedule" && kind !== "deliver") throw new AppError("INVALID_SERVICE_ACTION");
  // Rescheduling is an internal handoff, never a dated booking or new assignment.
  if (raw.date !== undefined || raw.scheduledAt !== undefined || raw.serviceDate !== undefined)
    throw new AppError("RESCHEDULE_HAS_NO_DATE");
  const note = serviceNote(raw.note);
  let reason: RejectionReason | null = null;
  if (kind === "reject") {
    if (raw.reasonCode !== "poor_quality" && raw.reasonCode !== "late_arrival" && raw.reasonCode !== "other")
      throw new AppError("INVALID_REJECTION_REASON");
    reason = raw.reasonCode;
    if (reason === "other" && !note) throw new AppError("REJECTION_NOTE_REQUIRED");
  } else if (raw.reasonCode !== undefined && raw.reasonCode !== null) throw new AppError("INVALID_REJECTION_REASON");
  return { kind, reason, note };
}

export function serviceTransition(status: DriverOrderStatus, kind: DriverServiceKind): DriverOrderStatus {
  const allowed: Record<DriverServiceKind, readonly DriverOrderStatus[]> = {
    reject: ["open", "closed_pending"],
    reschedule: ["closed_pending"],
    deliver: ["open", "closed_pending", "rejected"],
  };
  if (!allowed[kind].includes(status)) throw new AppError("ORDER_STATE_CONFLICT", 409);
  return { reject: "rejected", reschedule: "rescheduled", deliver: "delivered" }[kind] as DriverOrderStatus;
}
