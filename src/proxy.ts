import { NextRequest, NextResponse } from "next/server";
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const maps = Boolean(
    process.env.RUTAS_GOOGLE_MAPS_BROWSER_KEY &&
    process.env.RUTAS_GOOGLE_MAP_ID,
  );
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development || maps ? " 'unsafe-eval'" : ""}${maps ? " https://*.googleapis.com blob:" : ""}; style-src 'self' 'unsafe-inline'${maps ? " https://fonts.googleapis.com" : ""}; img-src 'self' data:${maps ? " https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com" : ""}; font-src 'self'${maps ? " https://fonts.gstatic.com" : ""}; connect-src 'self'${development ? " ws: wss:" : ""}${maps ? " https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:" : ""}; frame-src 'self'${maps ? " https://*.google.com" : ""}; worker-src 'self'${maps ? " blob:" : ""}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
