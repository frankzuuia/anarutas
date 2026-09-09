import { NextResponse } from "next/server";
import { putDocument, readDocument } from "@/core/driver-documents";
import { throttle } from "@/core/auth";
import { endpoint, json, principal } from "@/server/http";
import { documentBody } from "@/server/document-body";
type Context = { params: Promise<{ id: string; kind: string }> };
export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { pool } = await principal();
    const { id, kind } = await context.params;
    return new NextResponse(
      new Uint8Array(await readDocument(pool, id, kind)),
      {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": 'inline; filename="document.webp"',
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      },
    );
  });
}
export function PUT(request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, user, config } = await principal();
    await throttle(pool, `document:${user.id}`, 20);
    const { id, kind } = await context.params;
    const { bytes, contentType, version } = await documentBody(
      request,
      config.origin,
    );
    return json(
      await putDocument(pool, user.id, id, kind, version, bytes, contentType),
    );
  });
}
