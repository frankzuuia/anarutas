// Read-only metadata probe; never logs credentials or operational note contents.
export {};
const url = process.env.ODOO_URL!;
const db = process.env.ODOO_DATABASE!;
const login = process.env.ODOO_USERNAME || process.env.ODOO_EMAIL;
const secret = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD;
async function rpc(service: string, method: string, args: unknown[]) {
  const response = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: 1,
      params: { service, method, args },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error("ODOO_METADATA_READ_FAILED");
  return data.result;
}
const uid = await rpc("common", "authenticate", [db, login, secret, {}]);
if (!uid) throw new Error("ODOO_AUTH_FAILED");
for (const model of ["sale.order.line", "stock.move", "stock.move.line"]) {
  const fields = await rpc("object", "execute_kw", [
    db,
    uid,
    secret,
    model,
    "fields_get",
    [],
    {
      attributes: ["string", "type", "related"],
      context: {
        lang: "es_419",
        allowed_company_ids: [Number(process.env.ODOO_COMPANY_ID)],
      },
    },
  ]);
  const matches = Object.entries(fields).filter(([key, value]) => {
    const field = value as { string: string };
    const label = `${key} ${field.string}`.toLowerCase();
    return ["nota", "note", "pick"].some((term) => label.includes(term));
  });
  console.log(JSON.stringify({ model, fields: Object.fromEntries(matches) }));
}
