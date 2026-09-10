import { listCustomers } from "@/core/customers";
import { AppError } from "@/core/errors";
import { integer } from "@/core/orders-validation";
import { endpoint, json, principal } from "@/server/http";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool } = await principal();
    const url = new URL(request.url);
    const archived = url.searchParams.get("archived") === "true";
    const query = url.searchParams.get("q") || "";
    if (query.length > 200) throw new AppError("INVALID_INPUT");
    const after = integer(Number(url.searchParams.get("after") || 0));
    const limit = integer(Number(url.searchParams.get("limit") || 100), 1);
    return json(await listCustomers(pool, { archived, query, after, limit }));
  });
}
