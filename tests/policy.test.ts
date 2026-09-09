import { describe, it, expect } from "vitest";
import {
  passwordAllowed,
  sameOrigin,
  sessionUsable,
  versionMatches,
} from "../src/core/policy";
describe("security predicates", () => {
  it("requires exact origin, never suffix or missing value", () => {
    expect(sameOrigin(null, "https://routes.example")).toBe(false);
    expect(sameOrigin("https://routes.example", "https://routes.example")).toBe(
      true,
    );
    expect(
      sameOrigin("https://routes.example.evil", "https://routes.example"),
    ).toBe(false);
    expect(sameOrigin("http://routes.example", "https://routes.example")).toBe(
      false,
    );
    expect(sameOrigin("", "https://routes.example")).toBe(false);
  });
  it("active, unrevoked and both deadlines strictly in the future", () => {
    expect(sessionUsable(true, false, 11, 11, 10)).toBe(true);
    expect(sessionUsable(false, false, 11, 11, 10)).toBe(false);
    expect(sessionUsable(true, true, 11, 11, 10)).toBe(false);
    expect(sessionUsable(true, false, 10, 11, 10)).toBe(false);
    expect(sessionUsable(true, false, 9, 11, 10)).toBe(false);
    expect(sessionUsable(true, false, 11, 10, 10)).toBe(false);
    expect(sessionUsable(true, false, 11, 9, 10)).toBe(false);
  });
  it.each([
    [5, false],
    [6, true],
    [7, true],
    [14, true],
    [15, true],
    [127, true],
    [128, true],
    [129, false],
    [0, false],
  ])("password length %i returns %s", (n, result) =>
    expect(passwordAllowed("a".repeat(n as number))).toBe(result),
  );
  it("version matches only positive integer expected version", () => {
    expect(versionMatches(1, 1)).toBe(true);
    expect(versionMatches(2, 2)).toBe(true);
    expect(versionMatches(1, 2)).toBe(false);
    expect(versionMatches(0, 0)).toBe(false);
    expect(versionMatches(-1, -1)).toBe(false);
    expect(versionMatches(1.1, 1.1)).toBe(false);
    expect(versionMatches(NaN, NaN)).toBe(false);
    expect(versionMatches(Infinity, Infinity)).toBe(false);
  });
});
