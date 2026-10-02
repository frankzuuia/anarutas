export type PlanCreationAttempt = {
  commandId: string;
  date: string;
  label: string;
};

export function planCreationAttempt(
  previous: PlanCreationAttempt | null,
  input: { date: string; label: string },
  newCommandId: () => string,
): PlanCreationAttempt {
  const date = input.date.trim();
  const label = input.label.trim();
  if (previous?.date === date && previous.label === label) return previous;
  return { commandId: newCommandId(), date, label };
}
