import type { Shipment } from "./orders-contract";

// Early reception is allowed. Each order can use its final closing; a shared
// physical visit must meet every member's closing. No window means no limit,
// not permission to erase another customer's deadline. Preserve source data.
export function receivingWindows(
  shipments: Pick<Shipment, "deliveryWindows">[],
): Shipment["deliveryWindows"] {
  const closings = shipments.flatMap(({ deliveryWindows }) => {
    if (!deliveryWindows.length) return [];
    return [
      deliveryWindows.reduce((last, window) =>
        window.endMinute > last.endMinute ? window : last,
      ),
    ];
  });
  const strictest = closings.sort(
    (a, b) => a.endMinute - b.endMinute || a.startMinute - b.startMinute,
  )[0];
  return strictest ? [{ ...strictest }] : [];
}
