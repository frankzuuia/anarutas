import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import {
  customerExportSnapshot,
  listCustomers,
  persistCustomerPage,
} from "../src/core/customers";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const source = createHash("sha256")
  .update("customers-performance")
  .digest("hex");

beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Customers Performance QA",
      login: "customers-performance-qa",
      password: randomUUID(),
    })
  ).id;
  await persistCustomerPage(db.pool, actor, {
    fingerprint: source,
    customers: [
      {
        partnerId: 1,
        parentId: null,
        parentName: null,
        commercialPartnerId: 1,
        commercialName: "Cliente objetivo 1",
        companyId: null,
        type: "contact",
        isCompany: true,
        active: true,
        name: "Cliente objetivo 1",
        reference: "PERF-1",
        phone: null,
        mobile: null,
        address: "Guadalajara",
      },
    ],
    nextCursor: 1,
    ceiling: 1,
    hasMore: false,
  });
  await db.pool.query(
    `INSERT INTO route_customers(
       id,source,odoo_partner_id,odoo_name,source_hash,display_name,
       delivery_address,search_key,created_by,updated_by
     )
     SELECT md5('performance-customer-' || number::text)::uuid,$1,number,
       'Cliente objetivo ' || number::text,md5(number::text),
       'Cliente objetivo ' || number::text,'Guadalajara',
       'cliente objetivo ' || number::text,$2,$2
     FROM generate_series(2,10000) AS number`,
    [source, actor],
  );
});

afterAll(async () => db?.close());

describe("customer directory performance / real PostgreSQL", () => {
  it("keeps normalized search p95 below 300 ms with 10,000 contacts", async () => {
    const count = await db.pool.query(
      "SELECT count(*)::integer AS count FROM route_customers",
    );
    expect(count.rows[0].count).toBe(10_000);
    await listCustomers(db.pool, {
      archived: false,
      query: "OBJETIVO 9999",
      limit: 10,
    });
    const samples: number[] = [];
    for (let index = 0; index < 30; index++) {
      const started = performance.now();
      const result = await listCustomers(db.pool, {
        archived: false,
        query: "objetivo 9999",
        limit: 10,
      });
      samples.push(performance.now() - started);
      expect(result.customers).toHaveLength(1);
      expect(result.customers[0].odooPartnerId).toBe(9999);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(`[quality] customer_search_10000_p95_ms=${p95.toFixed(2)}`);
    expect(p95).toBeLessThanOrEqual(300);
  });

  it("exports every page from one read-only snapshot", async () => {
    const customers = await customerExportSnapshot(db.pool, {
      archived: false,
    });
    expect(customers).toHaveLength(10_000);
    expect(customers[0].odooPartnerId).toBe(1);
    expect(customers.at(-1)!.odooPartnerId).toBe(10_000);
  });
});
