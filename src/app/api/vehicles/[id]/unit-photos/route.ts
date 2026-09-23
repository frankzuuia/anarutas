import { listAdminUnitPhotos } from "@/core/unit-photos";
import { endpoint, json, principal } from "@/server/http";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user, config } = await principal();
    const date = new URL(request.url).searchParams.get("date") ||
      new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return json(await listAdminUnitPhotos(pool, user.id, (await context.params).id, date, config.timezone));
  });
}
