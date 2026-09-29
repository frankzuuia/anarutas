import { NextResponse } from "next/server";
import { readProductIncidentEvidence } from "@/core/product-incidents-evidence";
import { endpoint, principal } from "@/server/http";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const bytes = await readProductIncidentEvidence(pool, user.id, (await context.params).id, undefined,
      new URL(request.url).searchParams.get("photoId"));
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  });
}
