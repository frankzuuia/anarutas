import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readConfig } from "@/core/config";
import { assertInstallation, getPool } from "@/core/database";
import { authenticate } from "@/core/auth";
import { AppError } from "@/core/errors";
import { sameOrigin } from "@/core/policy";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
export async function endpoint(action: () => Promise<NextResponse>) {
  const started = performance.now();
  const requestId = randomUUID();
  try {
    const response = await action();
    response.headers.set("X-Request-ID", requestId);
    response.headers.set(
      "Server-Timing",
      `app;dur=${(performance.now() - started).toFixed(1)}`,
    );
    return response;
  } catch (error) {
    const pgCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
    const status =
      error instanceof AppError
        ? error.status
        : pgCode === "23505"
          ? 409
          : pgCode === "22P02"
            ? 400
            : 503;
    const code =
      error instanceof AppError
        ? error.code
        : pgCode === "23505"
          ? "ALREADY_EXISTS"
          : pgCode === "22P02"
            ? "INVALID_INPUT"
            : "SERVICE_UNAVAILABLE";
    console.warn(
      JSON.stringify({
        requestId,
        status,
        code,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    return json({ error: code, requestId }, status);
  }
}
export async function body(request: Request) {
  const config = readConfig();
  if (!sameOrigin(request.headers.get("origin"), config.origin))
    throw new AppError("ORIGIN_DENIED", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AppError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > 8192) {
      await reader.cancel();
      throw new AppError("BODY_TOO_LARGE", 413);
    }
    chunks.push(chunk.value);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_JSON");
  }
}
export async function database() {
  const config = readConfig();
  const pool = getPool();
  await assertInstallation(pool, config.instanceId);
  return { pool, config };
}
export async function principal() {
  const { pool, config } = await database();
  const token = (await cookies()).get(config.cookieName)?.value;
  const user = await authenticate(pool, config, token);
  return { pool, config, token: token!, user };
}
export function sessionCookie(
  response: NextResponse,
  token: string,
  remove = false,
) {
  const config = readConfig();
  response.cookies.set(config.cookieName, token, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "strict",
    path: "/",
    maxAge: remove ? 0 : config.sessionHours * 3600,
  });
}
