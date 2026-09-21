import { AppError } from "@/core/errors";
import { authenticateMobile } from "@/core/driver-mobile-auth";
import { database } from "./http";

export async function mobileBody(request: Request, maximumBytes = 4096) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AppError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AppError("BODY_TOO_LARGE", 413);
    }
    chunks.push(chunk.value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("object required");
    return value as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_JSON");
  }
}

export async function mobilePrincipal(request: Request) {
  const { pool } = await database();
  const driver = await authenticateMobile(
    pool,
    request.headers.get("authorization"),
  );
  return { pool, driver };
}
