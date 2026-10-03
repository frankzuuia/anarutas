import type { GoogleOptimizationRequest } from "./route-optimization-google";

type Visit =
  GoogleOptimizationRequest["model"]["shipments"][number]["deliveries"][number];
type Window = { startTime: string; endTime: string };

// These are alternatives of ONE mandatory delivery, not duplicate shipments.
// A finite exception cost distinguishes missing a deadline from normal travel;
// proportional lateness still distinguishes the quality of late alternatives.
export function visitWindowAlternatives(
  windows: Window[],
  horizon: Window,
  lateRatePerHour: number,
  referenceHours: number,
): Pick<Visit, "cost" | "timeWindows">[] {
  if (!windows.length) return [{}];
  const departure = Date.parse(horizon.startTime);
  return windows.flatMap((window) => {
    const opening = Math.max(departure, Date.parse(window.startTime));
    const closing = Date.parse(window.endTime);
    const lateStart = new Date(Math.max(departure, closing)).toISOString();
    return [
      ...(opening <= closing
        ? [
            {
              timeWindows: [
                {
                  startTime: new Date(opening).toISOString(),
                  endTime: window.endTime,
                },
              ],
            },
          ]
        : []),
      {
        // Include already unavoidable delay when departing after a closing.
        // The reference scale is derived from the current batch's own windows.
        cost:
          lateRatePerHour * referenceHours +
          (lateRatePerHour * Math.max(0, departure - closing)) / 3_600_000,
        timeWindows: [
          {
            startTime: lateStart,
            endTime: horizon.endTime,
            softEndTime: lateStart,
            costPerHourAfterSoftEndTime: lateRatePerHour,
          },
        ],
      },
    ];
  });
}
