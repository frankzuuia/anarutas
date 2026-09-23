import { NextResponse } from "next/server";
import { panelEventStream } from "@/core/panel-event-stream";
import { endpoint, principal } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config, token } = await principal();
    return new NextResponse(
      panelEventStream(pool, config, token, request.signal),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store, private, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  });
}
