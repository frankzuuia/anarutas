import { NextResponse } from "next/server";
import { readIncidentEvidence } from "@/core/driver-incident-evidence";
import { endpoint, principal } from "@/server/http";
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const bytes = await readIncidentEvidence(pool, user.id, (await context.params).id);
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  });
}
