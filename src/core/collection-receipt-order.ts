type CollectionReceipt = { recordedAt: string; id: string };

/** Confirmed receipts are immutable; settlement status never changes their position. */
export function compareCollectionReceipts(
  left: CollectionReceipt,
  right: CollectionReceipt,
): number {
  return (
    Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
    left.id.localeCompare(right.id)
  );
}
