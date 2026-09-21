import {
  configureMobileAccess,
  mobileAccessStatus,
  revokeMobileAccess,
} from "@/core/driver-mobile-auth";
import { getDriver } from "@/core/fleet";
import { body, endpoint, json, principal } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { pool } = await principal();
    const { id } = await context.params;
    await getDriver(pool, id);
    return json(await mobileAccessStatus(pool, id));
  });
}

export function PUT(request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const { id } = await context.params;
    return json(
      await configureMobileAccess(pool, user.id, id, await body(request)),
    );
  });
}

export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const { id } = await context.params;
    const input = await body(request);
    return json(
      await revokeMobileAccess(pool, user.id, id, input.expectedMobileVersion),
    );
  });
}
