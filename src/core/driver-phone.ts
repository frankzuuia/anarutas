/**
 * Canonical Mexican mobile identity used by both administration and the APK.
 * Accepts national numbers, +52 and the retired +521 mobile prefix, but never
 * guesses arbitrary international numbers by taking their last ten digits.
 */
export function normalizeDriverPhone(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const trimmed = value.trim();
  let digits = "";
  for (const [index, character] of [...trimmed].entries()) {
    if (character >= "0" && character <= "9") digits += character;
    else if (character === "+" && index === 0) continue;
    else if (!["-", "(", ")", " ", "."].includes(character)) return null;
  }
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
  return null;
}
