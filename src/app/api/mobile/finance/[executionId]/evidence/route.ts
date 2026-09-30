import { NextResponse } from "next/server";
import { endpoint, database } from "@/server/http";
import { readFinanceEvidence } from "@/core/finance-evidence";
export function GET(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const { pool } = await database(),
      query = new URL(request.url).searchParams;
    const bytes = await readFinanceEvidence(
      pool,
      { authorization: request.headers.get("authorization") },
      (await context.params).executionId,
      query.get("incidentId") ?? "",
      query.get("photoId") ?? "",
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
