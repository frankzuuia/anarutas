import { customerExportSnapshot } from "@/core/customers";
import { customerWorkbook } from "@/core/excel";
import { AppError } from "@/core/errors";
import { endpoint, principal } from "@/server/http";
import { xlsx } from "@/server/xlsx";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool } = await principal();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";
    if (query.length > 200) throw new AppError("INVALID_INPUT");
    const archived = url.searchParams.get("archived") === "true";
    const customers = await customerExportSnapshot(pool, { archived, query });
    return xlsx(
      await customerWorkbook(customers),
      `ana-rutas-clientes-${archived ? "archivados" : "activos"}.xlsx`,
    );
  });
}
