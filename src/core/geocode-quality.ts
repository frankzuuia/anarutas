export type GeocodeQualityInput = {
  partialMatch: boolean;
  locationType: string;
  types: readonly string[];
};

export type GeocodeQualityIssue =
  "PARTIAL_MATCH" | "APPROXIMATE_LOCATION" | "NOT_A_DELIVERY_ADDRESS";

export function geocodeQualityIssue(
  result: GeocodeQualityInput,
): GeocodeQualityIssue | null {
  if (result.partialMatch) return "PARTIAL_MATCH";
  if (
    result.locationType !== "ROOFTOP" &&
    result.locationType !== "RANGE_INTERPOLATED"
  )
    return "APPROXIMATE_LOCATION";
  if (
    !result.types.some((type) =>
      ["street_address", "premise", "subpremise"].includes(type),
    )
  )
    return "NOT_A_DELIVERY_ADDRESS";
  return null;
}
