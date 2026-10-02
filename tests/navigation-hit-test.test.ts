import { expect, it } from "vitest";
import { outsideNavigationBounds } from "../src/components/navigation-hit-test";

const bounds = { left: 12, top: 24, right: 272, bottom: 620 };
it.each([
  [12, 24, false],
  [150, 300, false],
  [271.99, 619.99, false],
  [11.99, 300, true],
  [272, 300, true],
  [272.01, 300, true],
  [150, 23.99, true],
  [150, 620, true],
  [150, 620.01, true],
  [12, 300, false],
  [150, 24, false],
  [-1, -1, true],
])(
  "classifies backdrop point (%s,%s) as outside=%s without treating panel edges as a tap outside",
  (x, y, outside) => {
    expect(
      outsideNavigationBounds({ x: Number(x), y: Number(y) }, bounds),
    ).toBe(outside);
  },
);
