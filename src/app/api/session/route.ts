import { login, logout } from "@/core/auth";
import {
  body,
  database,
  endpoint,
  json,
  principal,
  sessionCookie,
} from "@/server/http";
export const dynamic = "force-dynamic";
export function GET() {
  return endpoint(async () => json((await principal()).user));
}
export function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, config } = await database();
    const result = await login(pool, config, input);
    const response = json(result.user);
    sessionCookie(response, result.token);
    return response;
  });
}
export function DELETE(request: Request) {
  return endpoint(async () => {
    await body(request);
    const { pool, user, token } = await principal();
    await logout(pool, user.id, token);
    const response = json({ closed: true });
    sessionCookie(response, "", true);
    return response;
  });
}
