import { describe, expect, it } from "vitest";
import { documentBody } from "../src/server/document-body";
import { maxDocumentBytes } from "../src/core/fleet-contract";
const origin = "https://rutas.example";
function request(
  headers: Record<string, string> = {},
  body: BodyInit | null = "bytes",
) {
  return new Request(`${origin}/api/drivers/id/documents/photo`, {
    method: "PUT",
    body,
    headers: {
      origin,
      "content-type": "image/png",
      "x-record-version": "1",
      ...headers,
    },
  });
}
describe("bounded authenticated document transport", () => {
  it("reads actual bytes without a declared content length", async () => {
    expect(await documentBody(request(), origin)).toEqual({
      bytes: Buffer.from("bytes"),
      contentType: "image/png",
      version: 1,
    });
    expect(
      (
        await documentBody(
          request({ "x-record-version": "2", "content-type": "image/webp" }),
          origin,
        )
      ).version,
    ).toBe(2);
  });
  it("rejects cross origin and missing origin before consuming a file", async () => {
    await expect(
      documentBody(request({ origin: "https://other.example" }), origin),
    ).rejects.toThrow("ORIGIN_DENIED");
    const missing = request();
    missing.headers.delete("origin");
    await expect(documentBody(missing, origin)).rejects.toThrow(
      "ORIGIN_DENIED",
    );
  });
  it("rejects unsupported content types and missing bodies", async () => {
    await expect(
      documentBody(request({ "content-type": "image/svg+xml" }), origin),
    ).rejects.toThrow("DOCUMENT_INVALID");
    await expect(documentBody(request({}, null), origin)).rejects.toThrow(
      "DOCUMENT_INVALID",
    );
    const missing = request();
    missing.headers.delete("content-type");
    await expect(documentBody(missing, origin)).rejects.toThrow(
      "DOCUMENT_INVALID",
    );
  });
  it.each(["", "0", "-1", "1.5", "bad", "9007199254740992"])(
    "rejects unsafe version %s",
    async (version) => {
      await expect(
        documentBody(request({ "x-record-version": version }), origin),
      ).rejects.toThrow("FLEET_CONFLICT");
    },
  );
  it("enforces declared and actual streaming bounds independently", async () => {
    await expect(
      documentBody(
        request({ "content-length": String(maxDocumentBytes + 1) }),
        origin,
      ),
    ).rejects.toThrow("DOCUMENT_TOO_LARGE");
    const largest = new Uint8Array(maxDocumentBytes);
    const exact = request(
      { "content-length": String(maxDocumentBytes) },
      largest,
    );
    expect((await documentBody(exact, origin)).bytes.length).toBe(
      maxDocumentBytes,
    );
    expect(exact.body!.locked).toBe(false);
    expect(
      (await documentBody(request({}, largest), origin)).bytes.length,
    ).toBe(maxDocumentBytes);
    const oversized = request(
      { "content-length": "1" },
      new Uint8Array(maxDocumentBytes + 1),
    );
    await expect(documentBody(oversized, origin)).rejects.toThrow(
      "DOCUMENT_TOO_LARGE",
    );
    expect(oversized.body!.locked).toBe(false);
  });
});
