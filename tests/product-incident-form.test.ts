import { expect, it } from "vitest";
import { legacyIncidentCommentNames as incidentCommentNames, legacyIncidentConcepts as incidentConcepts, incidentDepartments, productFormInput, productPhotoCount } from "../src/core/product-incident-form";
import { productIncidentInput } from "../src/core/product-incidents-policy";
import { productPhotosBody } from "../src/server/product-photos-body";

it("validates the v2 form and keeps legacy receipt inputs unchanged", () => {
  expect(productFormInput({ note: "legacy" })).toBeUndefined();
  for (const legacy of [{ concept: null }, { comments: [] }]) expect(() => productFormInput(legacy)).toThrow("INVALID_PRODUCT_FORM");
  expect(incidentDepartments).toEqual(["Operaciones", "Compras", "Ventas"]);
  expect(incidentConcepts).toEqual(["Especiales", "Reparto", "Picking"]);
  const form = { formVersion: 2, concept: "Picking", comments: [], note: "  Nota adicional  " };
  expect(productFormInput(form)).toEqual({ ...form, additionalNote: "Nota adicional", note: "Nota adicional" });
  expect(productFormInput({ ...form, note: undefined })).toMatchObject({ additionalNote: null, note: null });
  for (const concept of incidentConcepts) expect(productFormInput({ ...form, concept })?.concept).toBe(concept);
  for (const formVersion of [null, 1, 3, "2", {}, []]) expect(() => productFormInput({ ...form, formVersion })).toThrow("INVALID_PRODUCT_FORM");
  for (const concept of [undefined, null, "", "picking", "Otro", 2, {}, ["Picking"]]) expect(() => productFormInput({ ...form, concept })).toThrow("INVALID_PRODUCT_FORM");
  for (const comments of [undefined, null, "special", {}, [1], [null], [["special"]], ["constructor"], ["special", "special"], ["nope"], Array(5).fill("special")])
    expect(() => productFormInput({ ...form, comments })).toThrow("INVALID_PRODUCT_FORM");
  const codes = Object.keys(incidentCommentNames);
  expect(productFormInput({ ...form, comments: [...codes].reverse() })).toEqual({ ...form, comments: codes,
    additionalNote: "Nota adicional", note: [...Object.values(incidentCommentNames), "Nota adicional"].join("\n") });
  for (const code of codes) expect(productFormInput({ ...form, comments: [code], note: "" })?.note).toBe(incidentCommentNames[code as keyof typeof incidentCommentNames]);
  expect(productFormInput({ ...form, note: "a".repeat(2000) })?.note?.length).toBe(2000);
  expect(() => productFormInput({ ...form, note: "a".repeat(2001) })).toThrow();
  expect(() => productFormInput({ ...form, comments: ["special"], note: "a".repeat(2000) })).toThrow();
  expect(productIncidentInput({ ...form, kind: "shortage_validation", product: "Limón", unit: "kg", quantity: "1", department: "Ventas" }))
    .toMatchObject({ department: "Ventas", concept: "Picking", note: "Nota adicional", additionalNote: "Nota adicional" });
  for (const count of [0, 1, 2, 3]) expect(() => productPhotoCount(count)).not.toThrow();
  for (const count of [-1, 4, .5, NaN, Infinity]) expect(() => productPhotoCount(count)).toThrow("INVALID_PRODUCT_PHOTO_COUNT");
});

function multipart(command: unknown = { formVersion: 2 }, sizes = [1], extra = false) {
  const form = new FormData();
  form.append("command", typeof command === "string" ? command : JSON.stringify(command));
  for (const [index, size] of sizes.entries()) form.append("photos", new Blob([new Uint8Array(size)], { type: "image/jpeg" }), `${index}.jpg`);
  if (extra) form.append("unexpected", "no");
  return new Request("http://localhost/incidents", { method: "POST", body: form });
}
it("bounds multipart metadata and every photo before image decoding", async () => {
  for (const count of [0, 1, 2, 3]) expect((await productPhotosBody(multipart({ formVersion: 2 }, Array(count).fill(8)))).photos).toHaveLength(count);
  await expect(productPhotosBody(multipart({}, [1]))).rejects.toThrow("INVALID_PRODUCT_FORM");
  for (const command of [null, [], "invalid", true, 3, "a".repeat(16_385)]) await expect(productPhotosBody(multipart(command))).rejects.toThrow("INVALID_PRODUCT_FORM");
  await expect(productPhotosBody(multipart({ formVersion: 2 }, [1], true))).rejects.toThrow("INVALID_PRODUCT_FORM");
  for (const sizes of [[0], [8 * 1024 * 1024 + 1]]) await expect(productPhotosBody(multipart({ formVersion: 2 }, sizes))).rejects.toMatchObject({ code: "UNIT_PHOTO_TOO_LARGE", status: 413 });
  await expect(productPhotosBody(multipart({ formVersion: 2 }, [1, 1, 1, 1]))).rejects.toThrow("INVALID_PRODUCT_PHOTO_COUNT");
  const valid = await productPhotosBody(multipart({ formVersion: 2 }, [8 * 1024 * 1024]));
  expect(valid.photos[0].bytes.length).toBe(8 * 1024 * 1024);
  for (const value of ["text", new Blob(["bad"], { type: "text/plain" })]) {
    const data = new FormData(); data.set("command", '{"formVersion":2}'); data.append("photos", value);
    await expect(productPhotosBody(new Request("http://localhost", { method: "POST", body: data }))).rejects.toMatchObject({ code: "UNIT_PHOTO_INVALID", status: 415 });
  }
  const duplicate = new FormData(); duplicate.append("command", '{"formVersion":2}'); duplicate.append("command", '{"formVersion":2}');
  await expect(productPhotosBody(new Request("http://localhost", { method: "POST", body: duplicate }))).rejects.toThrow("INVALID_PRODUCT_FORM");
  await expect(productPhotosBody(new Request("http://localhost", { method: "POST" }))).rejects.toThrow("INVALID_PRODUCT_FORM");
  await expect(productPhotosBody(new Request("http://localhost", { method: "POST", body: "bad", headers: { "Content-Type": "multipart/form-data" } }))).rejects.toThrow("INVALID_PRODUCT_FORM");
  const oversized = multipart(); oversized.headers.set("Content-Length", String(3 * 8 * 1024 * 1024 + 32_769));
  await expect(productPhotosBody(oversized)).rejects.toMatchObject({ code: "UNIT_PHOTO_TOO_LARGE", status: 413 });
  const streamed = new Request("http://localhost", { method: "POST", body: new Uint8Array(3 * 8 * 1024 * 1024 + 32_769) });
  await expect(productPhotosBody(streamed)).rejects.toMatchObject({ code: "UNIT_PHOTO_TOO_LARGE", status: 413 });
  expect(streamed.body?.locked).toBe(false);
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    const data = new FormData(); data.set("command", '{"formVersion":2}'); data.append("photos", new Blob(["photo"], { type }));
    const request = new Request("http://localhost", { method: "POST", body: data });
    const decoded = await productPhotosBody(request);
    expect(decoded.photos).toEqual([{ contentType: type, bytes: Buffer.from("photo") }]);
    expect(request.body?.locked).toBe(false);
  }
  const fileCommand = new FormData(); fileCommand.set("command", new Blob(['{"formVersion":2}']));
  await expect(productPhotosBody(new Request("http://localhost", { method: "POST", body: fileCommand }))).rejects.toThrow("INVALID_PRODUCT_FORM");
  const validJson = JSON.stringify({ formVersion: 2 });
  await expect(productPhotosBody(multipart(validJson.padEnd(16_384, " ")))).resolves.toMatchObject({ raw: { formVersion: 2 } });
  await expect(productPhotosBody(multipart(validJson.padEnd(16_385, " ")))).rejects.toThrow("INVALID_PRODUCT_FORM");
  const missingType = multipart(); missingType.headers.delete("Content-Type");
  await expect(productPhotosBody(missingType)).rejects.toThrow("INVALID_PRODUCT_FORM");
  const maximum = 3 * 8 * 1024 * 1024 + 32_768;
  const original = multipart({ formVersion: 2 }, Array(3).fill(8 * 1024 * 1024));
  const encoded = new Uint8Array(maximum); encoded.set(new Uint8Array(await original.arrayBuffer()));
  const boundary = new Request("http://localhost", { method: "POST", body: encoded,
    headers: { "Content-Type": original.headers.get("Content-Type")!, "Content-Length": String(maximum) } });
  const parsed = await productPhotosBody(boundary);
  expect(parsed.photos).toHaveLength(3); expect(parsed.photos.every(file => file.bytes.length === 8 * 1024 * 1024)).toBe(true);
});
