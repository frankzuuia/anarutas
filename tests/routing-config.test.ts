import { describe, expect, it } from "vitest";
import {
  readGoogleRoutingConfig,
  readRoutingDefaults,
} from "../src/core/routing-config";
import { routingSettingsInput } from "../src/core/routing-validation";

function serviceAccount(project = "ana-rutas-develop") {
  return Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: project,
      client_email: `optimizer@${project}.iam.gserviceaccount.com`,
      private_key:
        "-----BEGIN PRIVATE KEY-----\nQA\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  ).toString("base64");
}

describe("private Google routing configuration", () => {
  it("requires a matching project and valid service-account envelope", () => {
    expect(
      readGoogleRoutingConfig({
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: "ana-rutas-develop",
        RUTAS_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount(),
      }),
    ).toMatchObject({ projectId: "ana-rutas-develop" });
    expect(() =>
      readGoogleRoutingConfig({
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: "another-project",
        RUTAS_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount(),
      }),
    ).toThrow("ROUTING_CONFIG_INVALID");
  });

  it.each(["", "not base64", Buffer.from("{}").toString("base64")])(
    "fails closed for malformed credentials",
    (value) =>
      expect(() =>
        readGoogleRoutingConfig({
          RUTAS_GOOGLE_CLOUD_PROJECT_ID: "ana-rutas-develop",
          RUTAS_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: value,
        }),
      ).toThrow(),
  );

  it("exposes only the bounded depot-address suggestion", () => {
    expect(
      readRoutingDefaults({ RUTAS_DEPOT_ADDRESS: "  Calle 5 1106  " }),
    ).toEqual({ depotAddress: "Calle 5 1106" });
    expect(
      readRoutingDefaults({ RUTAS_DEPOT_ADDRESS: "x".repeat(600) })
        .depotAddress,
    ).toHaveLength(500);
  });

  it("accepts only a bounded, versioned and confirmed route origin", () => {
    expect(
      routingSettingsInput({
        depotAddress: " Calle 5 1106 ",
        depotLocation: {
          latitude: 20.624,
          longitude: -103.354,
          placeId: null,
        },
        expectedVersion: 0,
      }),
    ).toEqual({
      depotAddress: "Calle 5 1106",
      depotLocation: {
        latitude: 20.624,
        longitude: -103.354,
        placeId: null,
      },
      expectedVersion: 0,
    });
    expect(
      routingSettingsInput({
        depotAddress: "x".repeat(500),
        depotLocation: {
          latitude: -90,
          longitude: -180,
          placeId: ` ${"p".repeat(300)} `,
        },
        expectedVersion: 3,
      }),
    ).toEqual({
      depotAddress: "x".repeat(500),
      depotLocation: {
        latitude: -90,
        longitude: -180,
        placeId: "p".repeat(300),
      },
      expectedVersion: 3,
    });
    expect(
      routingSettingsInput({
        depotAddress: "Límite superior",
        depotLocation: { latitude: 90, longitude: 180, placeId: 123 },
        expectedVersion: 1,
      }).depotLocation,
    ).toEqual({ latitude: 90, longitude: 180, placeId: "123" });
    for (const invalid of [
      {
        depotAddress: null,
        depotLocation: { latitude: 20, longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "",
        depotLocation: { latitude: 20, longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "x".repeat(501),
        depotLocation: { latitude: 20, longitude: -103 },
        expectedVersion: 0,
      },
      { depotAddress: "Calle 5", depotLocation: null, expectedVersion: 0 },
      { depotAddress: "Calle 5", depotLocation: [], expectedVersion: 0 },
      { depotAddress: "Calle 5", depotLocation: "punto", expectedVersion: 0 },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: "20", longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: Number.NaN, longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: -90.0001, longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: 91, longitude: -103 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: 20, longitude: 180.0001 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: 20, longitude: -181 },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: {
          latitude: 20,
          longitude: -103,
          placeId: "x".repeat(301),
        },
        expectedVersion: 0,
      },
      {
        depotAddress: "Calle 5",
        depotLocation: { latitude: 20, longitude: -103, placeId: "" },
        expectedVersion: 0,
      },
    ])
      expect(() => routingSettingsInput(invalid)).toThrow(
        "ROUTING_SETTINGS_INVALID",
      );
  });
});
