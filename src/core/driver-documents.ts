import sharp from "sharp";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { transaction, audit, type Sql } from "./database";
import { checkFleetVersion, fleetLock, getDriver } from "./fleet";
import { documentKind } from "./fleet-validation";
import { maxDocumentBytes } from "./fleet-contract";
import { AppError } from "./errors";

const formats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
let decoding = 0;
export async function sanitizeDocument(data: Buffer, contentType: string) {
  if (!data.length || data.length > maxDocumentBytes)
    throw new AppError("DOCUMENT_TOO_LARGE", 413);
  if (!Object.hasOwn(formats, contentType))
    throw new AppError("DOCUMENT_INVALID", 415);
  if (decoding >= 2) throw new AppError("DOCUMENT_BUSY", 429);
  decoding++;
  try {
    const image = sharp(data, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (metadata.format !== formats[contentType] || (metadata.pages ?? 1) !== 1)
      throw new AppError("DOCUMENT_INVALID", 415);
    const result = await image
      .rotate()
      .webp({ lossless: true })
      .timeout({ seconds: 15 })
      .toBuffer();
    if (result.length > maxDocumentBytes)
      throw new AppError("DOCUMENT_TOO_LARGE", 413);
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("DOCUMENT_INVALID", 415);
  } finally {
    decoding--;
  }
}
export async function putDocument(
  pool: Pool,
  actor: string,
  id: string,
  kindInput: unknown,
  version: unknown,
  bytes: Buffer,
  contentType: string,
) {
  const kind = documentKind(kindInput);
  const data = await sanitizeDocument(bytes, contentType);
  const hash = createHash("sha256").update(data).digest("hex");
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const driver = await getDriver(sql, id);
    checkFleetVersion(version, driver.version);
    await sql.query(
      `INSERT INTO route_driver_documents(driver_id,kind,data,content_hash,uploaded_by) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(driver_id,kind) DO UPDATE SET data=EXCLUDED.data,content_hash=EXCLUDED.content_hash,uploaded_by=EXCLUDED.uploaded_by,updated_at=now()`,
      [id, kind, data, hash, actor],
    );
    await sql.query(
      "UPDATE route_drivers SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",
      [id, actor],
    );
    await audit(sql, actor, "driver.document.saved", id, {
      kind,
      bytes: data.length,
      version: driver.version + 1,
    });
    return getDriver(sql, id);
  });
}
export async function readDocument(
  sql: Sql,
  id: string,
  kindInput: unknown,
): Promise<Buffer> {
  const kind = documentKind(kindInput);
  const { rows } = await sql.query(
    "SELECT data FROM route_driver_documents WHERE driver_id=$1 AND kind=$2",
    [id, kind],
  );
  if (!rows.length) throw new AppError("FLEET_NOT_FOUND", 404);
  return rows[0].data;
}
