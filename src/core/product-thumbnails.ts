import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Pool } from "pg";
import { readDriverPlan } from "./driver-mobile-route";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { readProductThumbnails } from "./odoo";
import type { ShipmentLine } from "./orders-contract";
import { ProductThumbnailCache } from "./product-thumbnail-cache";

const images = new ProductThumbnailCache();

export async function normalizeProductThumbnail(image: unknown): Promise<Buffer | null> {
  if (typeof image !== "string" || !image.length || image.length > 180_000) return null;
  try {
    const bytes = Buffer.from(image, "base64");
    if (bytes.toString("base64") !== image) return null;
    const result = await sharp(bytes, { limitInputPixels: 262_144, animated: false })
      .rotate().resize(128, 128, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return result.length <= 65_536 ? result : null;
  } catch { return null; }
}

export async function resolveDriverProductThumbnail(pool: Pool, driverId: string, planId: string,
  shipmentId: string, lineIndex: number, revision: number, timezone: string) {
  const shipment = uuid(shipmentId), index = integer(lineIndex), expectedRevision = integer(revision, 1);
  const plan = await readDriverPlan(pool, driverId, planId, timezone);
  if (plan.publication.revision !== expectedRevision) throw new AppError("VERSION_CONFLICT", 409);
  const order = plan.orders.find((item: { id: string }) => item.id === shipment);
  if (!order || !order.lines[index]) throw new AppError("NOT_FOUND", 404);
  const original = (await pool.query<{ source: string; snapshot: { lines: ShipmentLine[] } }>(
    "SELECT source,snapshot FROM route_shipments WHERE id=$1 AND plan_id=$2", [shipment, planId],
  )).rows[0];
  if (!original) return null;
  // Older publications have no product id. Only use the immutable import when
  // its ordered lines still agree; never guess a product by its display name.
  const lines = original.snapshot.lines;
  if (lines.length !== order.lines.length || !lines.every((line, position) => {
    const published = order.lines[position];
    return line.name === published.name && line.quantity === published.quantity && line.unit === published.unit;
  })) return null;
  return { source: original.source, productId: integer(lines[index].productId, 1),
    productIds: [...new Set(lines.map(line => integer(line.productId, 1)))].sort((a, b) => a - b) };
}

export async function readDriverProductThumbnail(pool: Pool, driverId: string, planId: string,
  shipmentId: string, lineIndex: number, revision: number, timezone: string) {
  const product = await resolveDriverProductThumbnail(pool, driverId, planId, shipmentId, lineIndex, revision, timezone);
  if (!product) return null;
  const config = readOdooConfig();
  if (product.source !== config.fingerprint) throw new AppError("ODOO_SOURCE_CHANGED", 409);
  const key = createHash("sha256").update(JSON.stringify([
    config.fingerprint, config.username, config.credential, product.productIds,
  ])).digest("hex");
  const batch = await images.get(key, async () => {
    const raw = await readProductThumbnails(product.productIds, config);
    const normalized = new Map<number, Buffer | null>();
    for (const id of product.productIds) normalized.set(id, await normalizeProductThumbnail(raw.get(id)));
    return normalized;
  });
  // Recheck lifecycle after external I/O: cancellation/reassignment can happen
  // while Odoo responds, and cache hits do not confer access to another route.
  const current = await resolveDriverProductThumbnail(pool, driverId, planId, shipmentId, lineIndex, revision, timezone);
  if (!current || current.source !== product.source || current.productId !== product.productId) return null;
  return batch.get(product.productId) ?? null;
}
