// Static SQL fragments use the execution alias e. GPS and financial evidence stay
// distinct; their persisted timestamps define the terminal operational projection.
export const executionCompletionJoinsSql = `
  LEFT JOIN route_driver_execution_completions c ON c.execution_id=e.id
  LEFT JOIN route_driver_work_completions w ON w.execution_id=e.id`;
export const executionCompletedAtSql =
  "COALESCE(w.completed_at,c.completed_at)";
export const publicationExecutionJoinSql = `
  LEFT JOIN route_driver_executions e ON e.plan_id=pub.plan_id AND e.vehicle_id=pub.vehicle_id
    AND e.publication_revision=pub.revision AND e.driver_id=pub.started_driver_id`;

export function driverTodayPlan<
  T extends {
    service_date: string;
    completed_at: Date | null;
    work_completed_at: Date | null;
  },
>(plans: T[], serviceDate: string) {
  const current = plans.filter(
    (plan) => plan.service_date === serviceDate && !plan.work_completed_at,
  );
  return current.find((plan) => !plan.completed_at) ?? current[0] ?? null;
}
