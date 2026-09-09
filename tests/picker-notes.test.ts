import { expect, it } from "vitest";
import { pickerNoteField, pickerNoteValue } from "../src/core/picker-notes";
import { readMapConfig } from "../src/core/map-config";
it("resolves exact Studio metadata independently of technical field name", () => {
  expect(
    pickerNoteField({
      x_actual: { type: "char", string: " Nota para picker " },
      x_other: { type: "text", string: "Nota general" },
    }),
  ).toBe("x_actual");
  expect(
    pickerNoteField(
      { translated: { type: "text", string: "INSTRUCCIÓN" } },
      "",
      " instrucción ",
    ),
  ).toBe("translated");
  expect(pickerNoteField({ absent: undefined })).toBeNull();
  expect(pickerNoteField({})).toBeNull();
  expect(
    pickerNoteField({
      x_numeric: { type: "float", string: "Nota para picker" },
    }),
  ).toBeNull();
  expect(pickerNoteField({ unrelated: { type: "char" } })).toBeNull();
  for (const value of [null, [], 10])
    expect(() => pickerNoteField(value)).toThrow("ODOO_SCHEMA_UNSUPPORTED");
});
it("rejects ambiguous fields and invalid overrides", () => {
  const fields = {
    x_a: { type: "char", string: "Nota para picker" },
    x_b: { type: "text", string: "Nota para picker" },
  };
  expect(() => pickerNoteField(fields)).toThrow("ODOO_PICKER_FIELD_AMBIGUOUS");
  expect(pickerNoteField(fields, "x_b")).toBe("x_b");
  for (const value of ["missing", "toString"])
    expect(() => pickerNoteField(fields, value)).toThrow(
      "ODOO_PICKER_FIELD_INVALID",
    );
  expect(() => pickerNoteField({ x_a: { type: "many2one" } }, "x_a")).toThrow(
    "ODOO_PICKER_FIELD_INVALID",
  );
});
it("preserves operational text and handles Odoo false without inventing a note", () => {
  for (const value of [false, null, undefined, "", "   "])
    expect(pickerNoteValue(value)).toBeUndefined();
  expect(pickerNoteValue("  Maduro\nSeparar bolsas  ")).toBe(
    "Maduro\nSeparar bolsas",
  );
  expect(pickerNoteValue("<script>alert(1)</script>")).toBe(
    "<script>alert(1)</script>",
  );
  for (const value of [10, true, {}, []])
    expect(() => pickerNoteValue(value)).toThrow("ODOO_INVALID_RESPONSE");
});
it("publishes only explicitly configured browser map credentials", () => {
  expect(readMapConfig({})).toEqual({ configured: false });
  expect(readMapConfig({ RUTAS_GOOGLE_MAP_ID: "map-id" })).toEqual({
    configured: false,
  });
  expect(
    readMapConfig({ RUTAS_GOOGLE_MAPS_BROWSER_KEY: "browser-key" }),
  ).toEqual({ configured: false });
  expect(
    readMapConfig({
      GOOGLE_API_KEY: "server-secret",
      RUTAS_GOOGLE_MAP_ID: "id",
    }),
  ).toEqual({ configured: false });
  expect(
    readMapConfig({
      RUTAS_GOOGLE_MAPS_BROWSER_KEY: "   ",
      RUTAS_GOOGLE_MAP_ID: "id",
    }),
  ).toEqual({ configured: false });
  expect(
    readMapConfig({
      RUTAS_GOOGLE_MAPS_BROWSER_KEY: " browser-key ",
      RUTAS_GOOGLE_MAP_ID: " map-id ",
      ODOO_API_KEY: "private",
    }),
  ).toEqual({ configured: true, browserKey: "browser-key", mapId: "map-id" });
});
