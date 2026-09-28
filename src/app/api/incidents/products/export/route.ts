import { readProductIncidents } from "@/core/product-incidents";
import { productIncidentsWorkbook } from "@/core/product-incidents-excel";
import { endpoint, principal } from "@/server/http";
import { xlsx } from "@/server/xlsx";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, user, config } = await principal();
    const report = await readProductIncidents(pool, user.id, new URL(request.url).searchParams, config.timezone, "export");
    return xlsx(await productIncidentsWorkbook(report.rows), "incidencias-productos.xlsx");
  });
}
