import { AppError } from "./errors";
export function odooReturnConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const flag = env.RUTAS_ODOO_RETURNS_ENABLED?.trim() ?? "false";
  const pollSeconds = Number(
    env.RUTAS_ODOO_RETURNS_POLL_SECONDS?.trim() || "15",
  );
  if (
    !["true", "false"].includes(flag) ||
    !Number.isSafeInteger(pollSeconds) ||
    pollSeconds < 5 ||
    pollSeconds > 3600
  )
    throw new AppError("CONFIG_INVALID", 503);
  return { enabled: flag === "true", pollSeconds };
}
