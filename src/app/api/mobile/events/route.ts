import { NextResponse } from "next/server";
import { mobileEventStream } from "@/core/driver-mobile-events";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    return new NextResponse(
      mobileEventStream(
        pool,
        request.headers.get("authorization") ?? "",
        driver.driver_id,
        request.signal,
        config.panelHeartbeatSeconds,
      ),
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
