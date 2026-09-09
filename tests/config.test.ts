import { describe, it, expect } from "vitest";
import { readConfig, readOdooConfig } from "../src/core/config";
import { serviceDate } from "../src/core/plans";
const env = {
  RUTAS_INSTANCE_ID: "instance-alpha",
  RUTAS_APP_ORIGIN: "https://routes.example",
  RUTAS_DATABASE_URL: "postgresql://route:generated@localhost/routes",
  RUTAS_TIMEZONE: "America/Mexico_City",
};
const odoo = {
  ODOO_URL: "https://erp.example",
  ODOO_DATABASE: "company-database",
  ODOO_EMAIL: "integration",
  ODOO_API_KEY: "key-not-real",
  ODOO_COMPANY_ID: "7",
};
describe("portable runtime configuration", () => {
  it.each([
    "postgresql://",
    "postgresql://localhost/routes",
    "postgresql://route:password@localhost",
    "postgresql://route:password@localhost/routes?host=other",
  ])("requires a complete unambiguous dedicated DSN %s", (dsn) => {
    expect(() => readConfig({ ...env, RUTAS_DATABASE_URL: dsn })).toThrow(
      "CONFIG_INVALID",
    );
  });
  it("has no fallback to another project configuration", () => {
    expect(() => readConfig({ DATABASE_URL: env.RUTAS_DATABASE_URL })).toThrow(
      "CONFIG_MISSING",
    );
  });
  it("reads secure cookies and installation without build-time assumptions", () => {
    expect(readConfig(env)).toMatchObject({
      instanceId: "instance-alpha",
      secureCookie: true,
      sessionHours: 12,
      idleMinutes: 30,
    });
    expect(
      readConfig({ ...env, RUTAS_INSTANCE_ID: "instance-beta" }).instanceId,
    ).toBe("instance-beta");
  });
  it.each([
    "http://routes.example",
    "https://user:pass@routes.example",
    "https://routes.example/path",
    "https://routes.example?x=1",
    "https://routes.example#x",
    "invalid",
  ])("rejects unsafe application origin %s", (origin) =>
    expect(() => readConfig({ ...env, RUTAS_APP_ORIGIN: origin })).toThrow(),
  );
  it("allows HTTP only for loopback, not NODE_ENV based access bypass", () =>
    expect(
      readConfig({ ...env, RUTAS_APP_ORIGIN: "http://127.0.0.1:3000" })
        .secureCookie,
    ).toBe(false));
  it.each(["0", "-1", "bad", "1.1"])(
    "rejects invalid session lifetime %s",
    (hours) =>
      expect(() => readConfig({ ...env, RUTAS_SESSION_HOURS: hours })).toThrow(
        "CONFIG_INVALID",
      ),
  );
  it("rejects timezone, instance and non-Postgres DSN errors", () => {
    expect(() =>
      readConfig({ ...env, RUTAS_TIMEZONE: "unknown/zone" }),
    ).toThrow();
    expect(() =>
      readConfig({ ...env, RUTAS_INSTANCE_ID: "x".repeat(101) }),
    ).toThrow();
    expect(() =>
      readConfig({ ...env, RUTAS_DATABASE_URL: "https://db.example" }),
    ).toThrow();
  });
  it("supports credential aliases without hardcoding identity", () => {
    const first = readOdooConfig(odoo);
    const second = readOdooConfig({
      ...odoo,
      ODOO_EMAIL: undefined,
      ODOO_API_KEY: undefined,
      ODOO_USERNAME: "another",
      ODOO_PASSWORD: "another-key",
    });
    expect(second.username).toBe("another");
    expect(second.credential).toBe("another-key");
    expect(second.fingerprint).toBe(first.fingerprint);
  });
  it("partitions identities across all Odoo boundaries", () => {
    const original = readOdooConfig(odoo).fingerprint;
    for (const changed of [
      { ODOO_URL: "https://other.example" },
      { ODOO_DATABASE: "other" },
      { ODOO_COMPANY_ID: "8" },
    ])
      expect(readOdooConfig({ ...odoo, ...changed }).fingerprint).not.toBe(
        original,
      );
  });
  it.each([
    "http://erp.example",
    "https://user:pass@erp.example",
    "https://erp.example/path",
    "https://erp.example?query",
    "https://erp.example#hash",
  ])("rejects unsafe ERP URL %s", (value) =>
    expect(() => readOdooConfig({ ...odoo, ODOO_URL: value })).toThrow(),
  );
  it("requires explicit company and credential", () => {
    expect(() =>
      readOdooConfig({ ...odoo, ODOO_COMPANY_ID: undefined }),
    ).toThrow();
    expect(() =>
      readOdooConfig({ ...odoo, ODOO_API_KEY: undefined }),
    ).toThrow();
  });
  it("validates dates including leap years without locale guessing", () => {
    expect(serviceDate("2028-02-29")).toBe("2028-02-29");
    for (const date of [
      "2026-02-29",
      "2026-13-01",
      "2026-04-31",
      "09/08/2026",
      "yesterday",
    ])
      expect(() => serviceDate(date)).toThrow();
  });
});
