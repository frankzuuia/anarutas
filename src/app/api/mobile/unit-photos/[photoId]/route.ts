import { NextResponse } from "next/server";
import { readDriverUnitPhoto } from "@/core/unit-photos";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint } from "@/server/http";

export function GET(request: Request, context: { params: Promise<{ photoId: string }> }) {
  return endpoint(async () => {
    const { pool, driver } = await mobilePrincipal(request);
    const bytes = await readDriverUnitPhoto(pool, driver.driver_id, (await context.params).photoId);
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
