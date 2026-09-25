import { describe, expect, it } from "vitest";
import type { OrderBoard } from "../src/core/orders-contract";
import type { RoutingSettings } from "../src/core/routing-contract";
import {
  manualPreviewDecision,
  type ManualPreviewStatus,
} from "../src/core/manual-route-preview";

const board = {
  plan: { id: "plan", version: 7, departure_minute: 480 },
  shipments: [
    {
      vehicle_id: "truck",
      fulfillmentMode: "delivery",
      customerArchived: false,
      latitude: 20.6,
      longitude: -103.3,
      locationStatus: "confirmed",
    },
  ],
} as OrderBoard;
const settings = {
  depotLocation: { latitude: 20.6, longitude: -103.3, placeId: null },
} as RoutingSettings;
const status: ManualPreviewStatus = {
  version: 7,
  current: false,
  status: null,
  errorCode: null,
};

describe("one automatic manual road preview per plan version", () => {
  it("requests only the first missing road calculation", () => {
    expect(manualPreviewDecision(board, settings, status)).toBe("request");
    expect(
      manualPreviewDecision(board, settings, { ...status, current: true }),
    ).toBe("current");
    expect(
      manualPreviewDecision(board, settings, { ...status, status: "pending" }),
    ).toBe("waiting");
    expect(
      manualPreviewDecision(board, settings, { ...status, status: "running" }),
    ).toBe("waiting");
    expect(
      manualPreviewDecision(board, settings, { ...status, status: "failed" }),
    ).toBe("failed");
    expect(
      manualPreviewDecision(board, settings, { ...status, version: 8 }),
    ).toBe("stale");
  });

  it("does not request Google roads for incomplete or empty drafts", () => {
    expect(
      manualPreviewDecision(
        board,
        { ...settings, depotLocation: null },
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        { ...board, plan: { ...board.plan, departure_minute: null } },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision({ ...board, shipments: [] }, settings, status),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        { ...board, shipments: [{ ...board.shipments[0], latitude: null }] },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        {
          ...board,
          shipments: [{ ...board.shipments[0], locationStatus: "pending" }],
        },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        { ...board, shipments: [{ ...board.shipments[0], longitude: null }] },
        settings,
        status,
      ),
    ).toBe("incomplete");
  });

  it("ignores unassigned, archived and non-delivery orders while validating routed stops", () => {
    const unrouted = {
      ...board.shipments[0],
      vehicle_id: null,
      latitude: null,
      longitude: null,
    };
    const archived = {
      ...board.shipments[0],
      customerArchived: true,
      latitude: null,
      longitude: null,
    };
    const pickup = {
      ...board.shipments[0],
      fulfillmentMode: "pickup" as const,
      latitude: null,
      longitude: null,
    };
    expect(
      manualPreviewDecision(
        { ...board, shipments: [unrouted] },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        { ...board, shipments: [archived] },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        { ...board, shipments: [pickup] },
        settings,
        status,
      ),
    ).toBe("incomplete");
    expect(
      manualPreviewDecision(
        {
          ...board,
          shipments: [...board.shipments, unrouted, archived, pickup],
        },
        settings,
        status,
      ),
    ).toBe("request");
    expect(
      manualPreviewDecision(
        {
          ...board,
          shipments: [
            ...board.shipments,
            { ...board.shipments[0], longitude: null },
          ],
        },
        settings,
        status,
      ),
    ).toBe("incomplete");
  });
});
