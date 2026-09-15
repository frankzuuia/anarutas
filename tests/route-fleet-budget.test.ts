import { describe, expect, it } from "vitest";
import {
  fleetRoutingRequestAllowed,
  maximumFleetRoutingRequests,
} from "../src/core/route-fleet-budget";

describe("Fleet Routing request budget", () => {
  it("allows only the first two requests and never a third", () => {
    expect(maximumFleetRoutingRequests).toBe(2);
    expect(fleetRoutingRequestAllowed(0)).toBe(true);
    expect(fleetRoutingRequestAllowed(1)).toBe(true);
    expect(fleetRoutingRequestAllowed(2)).toBe(false);
    expect(fleetRoutingRequestAllowed(3)).toBe(false);
  });
});
