export function sameOrigin(actual: string | null, expected: string): boolean {
  return actual === expected;
}

export function sessionUsable(
  active: boolean,
  revoked: boolean,
  expires: number,
  idleExpires: number,
  now: number,
): boolean {
  return active && !revoked && expires > now && idleExpires > now;
}

export function passwordAllowed(password: string): boolean {
  return password.length >= 6 && password.length <= 128;
}

export function versionMatches(expected: number, actual: number): boolean {
  return Number.isInteger(expected) && expected > 0 && expected === actual;
}
