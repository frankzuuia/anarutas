import { NextResponse } from "next/server";
import { readAdminUnitPhoto } from "@/core/unit-photos";
import { endpoint, principal } from "@/server/http";

export function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const bytes = await readAdminUnitPhoto(pool, user.id, (await context.params).photoId);
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
