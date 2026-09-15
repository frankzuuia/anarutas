import { describe, expect, it } from "vitest";
import {
  fleetRoutingRequestAllowed,
  maximumFleetRoutingRequests,
} from "../src/core/route-fleet-budget";

describe("Fleet Routing request budget", () => {
  it("allows only the first request and never a second", () => {
    expect(maximumFleetRoutingRequests).toBe(1);
    expect(fleetRoutingRequestAllowed(0)).toBe(true);
    expect(fleetRoutingRequestAllowed(1)).toBe(false);
    expect(fleetRoutingRequestAllowed(2)).toBe(false);
    expect(fleetRoutingRequestAllowed(3)).toBe(false);
  });
});
