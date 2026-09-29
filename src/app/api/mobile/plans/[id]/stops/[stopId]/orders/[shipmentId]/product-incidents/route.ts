import { reportProductIncident } from "@/core/product-incidents";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
import { reportProductIncidentWithEvidence, reportProductIncidentWithPhotos } from "@/core/product-incidents-evidence";
import { productPhotosBody } from "@/server/product-photos-body";
import { unitPhotoBody } from "@/server/unit-photo-body";
import { AppError } from "@/core/errors";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string; shipmentId: string }> }) {
  return endpoint(async () => {
    const { pool, config } = await mobilePrincipal(request);
    const { id, stopId, shipmentId } = await context.params;
    if (request.headers.get("content-type")?.split(";")[0].trim() === "multipart/form-data") {
      const { raw, photos } = await productPhotosBody(request);
      return json(await reportProductIncidentWithPhotos(pool, request.headers.get("authorization"), id, stopId,
        shipmentId, raw, config.timezone, photos), 201);
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      let command: Record<string, unknown>;
      try {
        const encoded = request.headers.get("x-ana-rutas-command");
        if (!encoded || encoded.length > 12_000) throw new Error();
        command = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error();
      } catch { throw new AppError("INVALID_JSON"); }
      const { bytes, contentType } = await unitPhotoBody(request);
      return json(await reportProductIncidentWithEvidence(pool, request.headers.get("authorization"), id, stopId,
        shipmentId, command, config.timezone, bytes, contentType), 201);
    }
    return json(await reportProductIncident(pool, request.headers.get("authorization"), id, stopId,
      shipmentId, await mobileBody(request, 16_384), config.timezone), 201);
  });
}
