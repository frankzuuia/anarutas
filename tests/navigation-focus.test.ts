import { describe, expect, it } from "vitest";
import { navigationFocusTarget } from "../src/components/navigation-focus";

describe("navigation keyboard boundaries", () => {
  it.each([
    {
      items: ["first", "middle", "last"],
      current: "first",
      backwards: true,
      target: "last",
    },
    {
      items: ["first", "middle", "last"],
      current: "last",
      backwards: false,
      target: "first",
    },
    {
      items: ["first", "middle", "last"],
      current: "first",
      backwards: false,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: "last",
      backwards: true,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: "middle",
      backwards: true,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: "middle",
      backwards: false,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: "outside",
      backwards: true,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: "outside",
      backwards: false,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: null,
      backwards: true,
      target: undefined,
    },
    {
      items: ["first", "middle", "last"],
      current: null,
      backwards: false,
      target: undefined,
    },
    { items: [], current: null, backwards: true, target: undefined },
    { items: [], current: null, backwards: false, target: undefined },
    { items: ["only"], current: "only", backwards: true, target: "only" },
    { items: ["only"], current: "only", backwards: false, target: "only" },
  ])(
    "wraps $current with backwards=$backwards to $target",
    ({ items, current, backwards, target }) => {
      expect(navigationFocusTarget(items, current, backwards)).toBe(target);
    },
  );
});
