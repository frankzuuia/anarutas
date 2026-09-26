import { reportCustomerClosed } from "@/core/driver-closed-command";
import { tryCleanIncidentEvidence } from "@/core/driver-incident-evidence";
import { AppError } from "@/core/errors";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { unitPhotoBody } from "@/server/unit-photo-body";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string }> }) {
  return endpoint(async () => {
    const { pool, config } = await mobilePrincipal(request);
    const { id, stopId } = await context.params;
    let command: Record<string, unknown>;
    try {
      const encoded = request.headers.get("x-ana-rutas-command");
      if (!encoded || encoded.length > 12_000) throw new Error();
      command = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error();
    } catch { throw new AppError("INVALID_JSON"); }
    const { bytes, contentType } = await unitPhotoBody(request);
    const result = await reportCustomerClosed(pool, request.headers.get("authorization"), id, stopId,
      command, bytes, contentType, config.timezone);
    await tryCleanIncidentEvidence(pool);
    return json(result);
  });
}
