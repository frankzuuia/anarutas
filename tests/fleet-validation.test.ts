import { describe, expect, it } from "vitest";
import {
  bool,
  field,
  vehicleInput,
  driverInput,
  documentKind,
} from "../src/core/fleet-validation";
import { checkFleetVersion } from "../src/core/fleet";
const unit = {
  name: " Unidad ",
  brand: "Marca",
  model: "Modelo",
  plate: "ab- 123",
  mileage: 20.5,
  fuel: "Diésel",
  available: true,
};
const driver = {
  name: " Chofer QA ",
  phone: "3312345678",
  emergency_name: "",
  emergency_phone: "",
  blood_type: "",
  active: true,
};
describe("fleet data contracts", () => {
  it("normalizes plate and monetary-free mileage without altering intent", () => {
    expect(vehicleInput(unit)).toEqual({
      ...unit,
      name: "Unidad",
      plate: "AB123",
      mileage: "20.50",
    });
    expect(
      vehicleInput({ ...unit, mileage: 0, available: false }),
    ).toMatchObject({ mileage: "0.00", available: false });
    expect(vehicleInput({ ...unit, mileage: 9999999999.99 }).mileage).toBe(
      "9999999999.99",
    );
  });
  it.each([-1, NaN, Infinity, 10000000000, "20", null])(
    "rejects invalid mileage %s",
    (mileage) => {
      expect(() => vehicleInput({ ...unit, mileage })).toThrow("FLEET_INVALID");
    },
  );
  it("rejects invalid fuel, empty plate and boolean strings", () => {
    for (const patch of [
      { fuel: "unknown" },
      { plate: " - " },
      { available: "false" },
    ])
      expect(() => vehicleInput({ ...unit, ...patch })).toThrow(
        "FLEET_INVALID",
      );
    expect(bool(false)).toBe(false);
    expect(bool(true)).toBe(true);
    expect(() => bool(undefined)).toThrow("FLEET_INVALID");
  });
  it("allows optional emergency/blood fields and trims text", () => {
    expect(driverInput(driver)).toEqual({ ...driver, name: "Chofer QA" });
    expect(
      driverInput({ ...driver, blood_type: "AB-", active: false }),
    ).toMatchObject({ blood_type: "AB-", active: false });
    expect(() => driverInput({ ...driver, blood_type: "Z+" })).toThrow(
      "FLEET_INVALID",
    );
    expect(() => driverInput({ ...driver, phone: "1234" })).toThrow(
      "FLEET_INVALID",
    );
  });
  it("enforces text bounds and document allowlist", () => {
    expect(field(" a ")).toBe("a");
    expect(field("", 0)).toBe("");
    expect(field("x".repeat(120))).toHaveLength(120);
    expect(field("  " + "x".repeat(120) + "  ")).toHaveLength(120);
    for (const value of [null, 9, "", " ", "x".repeat(121)])
      expect(() => field(value)).toThrow("FLEET_INVALID");
    for (const kind of ["photo", "license_front", "license_back"])
      expect(documentKind(kind)).toBe(kind);
    for (const kind of ["../photo", "", null, "toString"])
      expect(() => documentKind(kind)).toThrow("DOCUMENT_INVALID");
  });
  it("requires matching numeric positive version", () => {
    expect(() => checkFleetVersion(1, 1)).not.toThrow();
    for (const version of [undefined, "1", 0, 2, 1.5])
      expect(() => checkFleetVersion(version, 1)).toThrow("FLEET_CONFLICT");
  });
});
