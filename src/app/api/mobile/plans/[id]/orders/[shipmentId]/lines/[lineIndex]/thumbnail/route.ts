import { NextResponse } from "next/server";
import { throttle } from "@/core/auth";
import { readDriverProductThumbnail } from "@/core/product-thumbnails";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint } from "@/server/http";

export function GET(request: Request, context: { params: Promise<{ id: string; shipmentId: string; lineIndex: string }> }) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    const { id, shipmentId, lineIndex } = await context.params;
    await throttle(pool, `product-thumbnail:${driver.device_id}`, 240);
    const bytes = await readDriverProductThumbnail(pool, driver.driver_id, id, shipmentId,
      Number(lineIndex), Number(new URL(request.url).searchParams.get("revision")), config.timezone);
    return new NextResponse(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 204, headers: {
      "Content-Type": "image/webp", "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  });
}
