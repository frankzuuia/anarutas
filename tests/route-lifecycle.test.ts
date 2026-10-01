import { expect, it } from "vitest";
import { driverTodayPlan } from "../src/core/route-lifecycle";
const at = new Date("2026-10-01T17:00:00Z");
const plan = {
  id: "route",
  service_date: "2026-10-01",
  completed_at: null,
  work_completed_at: null,
};
it("excludes finalized work from today while retaining a GPS-finished route awaiting settlement", () => {
  expect(driverTodayPlan([], plan.service_date)).toBeNull();
  expect(
    driverTodayPlan(
      [{ ...plan, service_date: "2026-09-30" }],
      plan.service_date,
    ),
  ).toBeNull();
  expect(
    driverTodayPlan(
      [{ ...plan, completed_at: at, work_completed_at: at }],
      plan.service_date,
    ),
  ).toBeNull();
  const returned = { ...plan, completed_at: at };
  expect(driverTodayPlan([returned], plan.service_date)).toBe(returned);
  expect(driverTodayPlan([returned, plan], plan.service_date)).toBe(plan);
  expect(
    driverTodayPlan(
      [{ ...plan, id: "closed", work_completed_at: at }, plan],
      plan.service_date,
    ),
  ).toBe(plan);
});
