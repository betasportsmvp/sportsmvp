/** True when the people charged for a consumption are no longer exactly the people marked present. */
export function allocationIsStale(chargedIds: Iterable<string>, presentIds: Iterable<string>): boolean {
  const charged = new Set(chargedIds);
  const present = new Set(presentIds);
  if (charged.size !== present.size) return true;
  for (const id of present) if (!charged.has(id)) return true;
  return false;
}

/** The equal split the database applies (rule `equal_split_v1`), for explaining amounts. */
export function equalSplit(totalMinor: number, people: number): { base: number; extra: number } {
  return { base: Math.floor(totalMinor / people), extra: totalMinor % people };
}
