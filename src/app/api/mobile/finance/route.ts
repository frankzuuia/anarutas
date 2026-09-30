import { endpoint, json, database } from "@/server/http";
import { listMobileFinance } from "@/core/finance-read";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool } = await database();
    return json(
      await listMobileFinance(
        pool,
        request.headers.get("authorization"),
        Number(new URL(request.url).searchParams.get("page") ?? 0),
      ),
    );
  });
}
