import { AppError } from "./errors";
export type AccountRole = "routes" | "settlement";
export function accountRole(value: unknown): AccountRole {
  if (value !== "routes" && value !== "settlement")
    throw new AppError("ACCOUNT_ROLE_INVALID");
  return value;
}
export function requireAccountRole(
  actual: AccountRole,
  expected: AccountRole | "any",
) {
  if (expected !== "any" && actual !== expected)
    throw new AppError("ROLE_DENIED", 403);
}
