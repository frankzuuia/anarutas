import { describe, expect, it } from "vitest";
import { geocodeQualityIssue } from "../src/core/geocode-quality";

describe("strict origin geocoding quality", () => {
  it("accepts precise street, premise and subpremise results", () => {
    for (const locationType of ["ROOFTOP", "RANGE_INTERPOLATED"])
      for (const type of ["street_address", "premise", "subpremise"])
        expect(
          geocodeQualityIssue({
            partialMatch: false,
            locationType,
            types: [type],
          }),
        ).toBeNull();
    expect(
      geocodeQualityIssue({
        partialMatch: false,
        locationType: "ROOFTOP",
        types: ["political", "street_address"],
      }),
    ).toBeNull();
  });

  it("rejects partial, approximate and non-address results", () => {
    expect(
      geocodeQualityIssue({
        partialMatch: true,
        locationType: "ROOFTOP",
        types: ["street_address"],
      }),
    ).toBe("PARTIAL_MATCH");
    for (const locationType of ["APPROXIMATE", "GEOMETRIC_CENTER"])
      expect(
        geocodeQualityIssue({
          partialMatch: false,
          locationType,
          types: ["street_address"],
        }),
      ).toBe("APPROXIMATE_LOCATION");
    for (const type of ["locality", "sublocality", "route"])
      expect(
        geocodeQualityIssue({
          partialMatch: false,
          locationType: "ROOFTOP",
          types: [type],
        }),
      ).toBe("NOT_A_DELIVERY_ADDRESS");
  });
});
