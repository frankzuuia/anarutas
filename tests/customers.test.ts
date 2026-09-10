import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import {
  archiveCustomer,
  listCustomers,
  persistCustomerPage,
  restoreCustomer,
  updateCustomer,
} from "../src/core/customers";
import type {
  CustomerSyncPage,
  SourceCustomer,
} from "../src/core/customers-contract";
import { createPlan } from "../src/core/plans";
import { orderBoard, persistImportPage } from "../src/core/orders";
import type { SourceShipment } from "../src/core/orders-contract";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const source = createHash("sha256").update("customers-qa").digest("hex");
const partner = (id: number, name = "Café Árbol"): SourceCustomer => ({
  partnerId: id,
  parentId: null,
  parentName: null,
  commercialPartnerId: id,
  commercialName: name,
  companyId: null,
  type: "contact",
  isCompany: true,
  active: true,
  name,
  reference: `REF-${id}`,
  phone: null,
  mobile: "3312345678",
  address: "Av. Vallarta 100, Guadalajara",
});
const page = (customers: SourceCustomer[]): CustomerSyncPage => ({
  fingerprint: source,
  customers,
  nextCursor: customers.at(-1)?.partnerId || 0,
  ceiling: customers.at(-1)?.partnerId || 0,
  hasMore: false,
});

beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Customers QA",
      login: "customers-qa",
      password: randomUUID(),
    })
  ).id;
});
afterAll(async () => db?.close());

describe("customer directory / real PostgreSQL", () => {
  it("keeps equal names as distinct Odoo identities and searches accents", async () => {
    expect(
      await persistCustomerPage(
        db.pool,
        actor,
        page([partner(101), partner(102)]),
      ),
    ).toMatchObject({ inserted: 2, existing: 0 });
    const all = await listCustomers(db.pool, { archived: false, limit: 100 });
    expect(all.customers).toHaveLength(2);
    expect(
      new Set(all.customers.map((customer) => customer.odooPartnerId)),
    ).toEqual(new Set([101, 102]));
    const found = await listCustomers(db.pool, {
      archived: false,
      query: "CAFE   arbol",
      limit: 100,
    });
    expect(found.customers).toHaveLength(2);
    expect(found.customers[0].phone).toBe("3312345678");
  });

  it("protects local settings across sync, versions location and resolves a plan", async () => {
    const original = (
      await listCustomers(db.pool, {
        archived: false,
        query: "REF-101",
        limit: 10,
      })
    ).customers[0];
    const updated = await updateCustomer(db.pool, actor, original.id, {
      displayName: "Sucursal Centro",
      phone: "3399999999",
      deliveryNote: "Usar puerta verde",
      priority: "high",
      fulfillmentMode: "delivery",
      deliveryAddress: "Calle Reforma 20, Guadalajara",
      mapUrl: null,
      location: {
        latitude: 20.6736,
        longitude: -103.344,
        placeId: "place-101",
      },
      windows: [
        {
          days: [0, 1, 2, 3, 4],
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ],
      expectedVersion: original.version,
    });
    expect(updated).toMatchObject({
      displayName: "Sucursal Centro",
      locationStatus: "confirmed",
      locationVersion: 1,
      priority: "high",
    });
    expect(updated.windows[0]).toMatchObject({
      startMinute: 660,
      endMinute: 780,
    });
    const changedSource = {
      ...partner(101, "Café Árbol renombrado en Odoo"),
      phone: "3300000000",
      mobile: null,
      address: "Dirección nueva de Odoo",
    };
    expect(
      await persistCustomerPage(db.pool, actor, page([changedSource])),
    ).toMatchObject({ inserted: 0, sourceChanged: 1 });
    const afterSync = (
      await listCustomers(db.pool, {
        archived: false,
        query: "renombrado",
        limit: 10,
      })
    ).customers[0];
    expect(afterSync).toMatchObject({
      displayName: "Sucursal Centro",
      phone: "3399999999",
      deliveryAddress: "Calle Reforma 20, Guadalajara",
      deliveryNote: "Usar puerta verde",
      odooName: "Café Árbol renombrado en Odoo",
      odooPhone: "3300000000",
      version: updated.version,
    });

    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-09",
      label: "Plan clientes QA",
    });
    const shipment: SourceShipment = {
      pickingId: 7001,
      pickingName: "WH/OUT/7001",
      orderId: 7001,
      orderName: "S07001",
      partnerId: 101,
      customerName: "Nombre snapshot",
      address: "Domicilio snapshot",
      validatedAt: "2026-09-09T12:00:00.000Z",
      promisedAt: null,
      backorderId: null,
      lines: [
        {
          moveId: 1,
          productId: 2,
          name: "Producto QA",
          quantity: 3,
          unit: "kg",
        },
      ],
    };
    await persistImportPage(db.pool, actor, plan.id, {
      fingerprint: source,
      shipments: [shipment],
      nextCursor: 1,
      ceiling: 1,
      hasMore: false,
      inspected: 1,
      excluded: 0,
    });
    const resolved = (await orderBoard(db.pool, plan.id)).shipments[0];
    expect(resolved).toMatchObject({
      customerName: "Sucursal Centro",
      address: "Calle Reforma 20, Guadalajara",
      phone: "3399999999",
      priority: "high",
      latitude: 20.6736,
      longitude: -103.344,
    });
    expect(resolved.deliveryWindows).toEqual([
      { startMinute: 660, endMinute: 780 },
    ]);
  });

  it("archives without deletion, sync does not reactivate, restores and rejects stale writes", async () => {
    const current = (
      await listCustomers(db.pool, {
        archived: false,
        query: "REF-102",
        limit: 10,
      })
    ).customers[0];
    const archived = await archiveCustomer(db.pool, actor, current.id, {
      expectedVersion: current.version,
    });
    expect(archived.archivedAt).not.toBeNull();
    await persistCustomerPage(
      db.pool,
      actor,
      page([partner(102, "Cambio fuente")]),
    );
    const stillArchived = (
      await listCustomers(db.pool, {
        archived: true,
        query: "Cambio fuente",
        limit: 10,
      })
    ).customers[0];
    expect(stillArchived.id).toBe(current.id);
    expect(stillArchived.archivedAt).not.toBeNull();
    await expect(
      restoreCustomer(db.pool, actor, current.id, {
        expectedVersion: current.version,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    const restored = await restoreCustomer(db.pool, actor, current.id, {
      expectedVersion: stillArchived.version,
    });
    expect(restored.archivedAt).toBeNull();
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::integer AS count FROM route_customers WHERE odoo_partner_id=102",
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
