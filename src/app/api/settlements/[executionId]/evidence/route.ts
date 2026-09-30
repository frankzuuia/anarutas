import { NextResponse } from "next/server";
import { endpoint, principal } from "@/server/http";
import { readFinanceEvidence } from "@/core/finance-evidence";
export function GET(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const { pool, user } = await principal("settlement"),
      query = new URL(request.url).searchParams;
    const bytes = await readFinanceEvidence(
      pool,
      { actor: user.id },
      (await context.params).executionId,
      query.get("incidentId") ?? "",
      query.get("photoId") ?? "",
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}
