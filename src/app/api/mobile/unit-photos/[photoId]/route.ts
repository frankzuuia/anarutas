import { NextResponse } from "next/server";
import { throttle } from "@/core/auth";
import { deleteDriverUnitPhoto, readDriverUnitPhoto } from "@/core/unit-photos";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

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

export function DELETE(request: Request, context: { params: Promise<{ photoId: string }> }) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    await throttle(pool, `unit-photo:${driver.driver_id}`, 30);
    return json(await deleteDriverUnitPhoto(
      pool, driver.driver_id, (await context.params).photoId, config.timezone,
    ));
  });
}
