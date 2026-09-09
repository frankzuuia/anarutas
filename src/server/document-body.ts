import { sameOrigin } from "../core/policy";
import { maxDocumentBytes } from "../core/fleet-contract";
import { AppError } from "../core/errors";

export async function documentBody(request: Request, origin: string) {
  if (!sameOrigin(request.headers.get("origin"), origin))
    throw new AppError("ORIGIN_DENIED", 403);
  // Stryker disable next-line StringLiteral: Any non-allowlisted fallback is rejected identically and never returned.
  const contentType = request.headers.get("content-type") || "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
    throw new AppError("DOCUMENT_INVALID", 415);
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxDocumentBytes)
    throw new AppError("DOCUMENT_TOO_LARGE", 413);
  const version = Number(request.headers.get("x-record-version"));
  if (!Number.isSafeInteger(version) || version < 1)
    throw new AppError("FLEET_CONFLICT", 409);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("DOCUMENT_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxDocumentBytes) {
        await reader.cancel();
        throw new AppError("DOCUMENT_TOO_LARGE", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), contentType, version };
}
