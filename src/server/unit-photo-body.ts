import { AppError } from "@/core/errors";

const maximum = 8 * 1024 * 1024;

export async function unitPhotoBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim() || "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
    throw new AppError("UNIT_PHOTO_INVALID", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("UNIT_PHOTO_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), contentType };
}
