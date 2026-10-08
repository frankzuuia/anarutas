import { AppError } from "../core/errors";
import { productPhotoCount, supportedProductFormVersion } from "../core/product-incident-form";

const photoMaximum = 8 * 1024 * 1024;
const maximum = 3 * photoMaximum + 32_768;

export async function productPhotosBody(request: Request) {
  if (Number(request.headers.get("content-length")) > maximum) throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_PRODUCT_FORM");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new AppError("UNIT_PHOTO_TOO_LARGE", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: request.headers,
  }).formData(); } catch { throw new AppError("INVALID_PRODUCT_FORM"); }
  if ([...form.keys()].some(key => key !== "command" && key !== "photos") || form.getAll("command").length !== 1)
    throw new AppError("INVALID_PRODUCT_FORM");
  const command = form.get("command");
  if (typeof command !== "string" || Buffer.byteLength(command) > 16_384) throw new AppError("INVALID_PRODUCT_FORM");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(command);
    // JSON primitives/arrays cannot carry a formVersion property; null is handled explicitly.
    if (!supportedProductFormVersion(raw?.formVersion)) throw new Error();
  } catch { throw new AppError("INVALID_PRODUCT_FORM"); }
  const files = form.getAll("photos");
  productPhotoCount(files.length);
  const photos: { bytes: Buffer; contentType: string }[] = [];
  for (const file of files) {
    if (typeof file === "string" || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new AppError("UNIT_PHOTO_INVALID", 415);
    if (file.size === 0 || file.size > photoMaximum) throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
    photos.push({ bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type });
  }
  return { raw, photos };
}
