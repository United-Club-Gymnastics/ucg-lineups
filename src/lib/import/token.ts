/** 128-bit random club token, base64url (22 chars). Knowing it is the only club credential. */
export function newClubToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Existing clubs keep their token; new clubs get a fresh one. */
export function assignTokens(clubIds: string[], existing: Record<string, string>, make: () => string = newClubToken): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of clubIds) out[id] = existing[id] || make();
  return out;
}
