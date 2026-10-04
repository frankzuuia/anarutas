import { AppError } from "./errors";

// Google may flag traffic infeasibilities and report a negative transition wait.
// Carry that deficit forward, consuming genuine waiting slack when available.
// This changes clocks only, never allocation, sequence, geometry or driving time.
export function trafficClock(
  visits: { eta: string; waitDurationSeconds: number }[],
  finishedAt: string | undefined,
  returnWait: number,
) {
  let shift = 0;
  let waiting = 0;
  const advance = (eta: string | undefined, wait: number) => {
    const instant = Date.parse(eta ?? "");
    if (!Number.isFinite(instant) || !Number.isFinite(wait))
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    const actualWait = Math.max(0, wait - shift);
    shift = Math.max(0, shift - wait);
    waiting += actualWait;
    return {
      eta: new Date(instant + shift * 1000).toISOString(),
      waitDurationSeconds: actualWait,
    };
  };
  const clocks = visits.map((visit) =>
    advance(visit.eta, visit.waitDurationSeconds),
  );
  const finish = advance(finishedAt, returnWait).eta;
  return {
    clocks,
    finishedAt: finish,
    waitDurationSeconds: waiting,
    addedSeconds: shift,
  };
}
