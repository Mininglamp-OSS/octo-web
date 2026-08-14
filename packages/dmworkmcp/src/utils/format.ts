/** Compact metric formatter (e.g. 1.2K / 3.4M) for card / detail stats,
 *  mirroring the skill market's formatCount (dmworkskillmarket utils/format.ts).
 *  Deliberately a local copy: dmworkmcp does depend on @dmwork/skillmarket, but
 *  that package's index intentionally exports only its module + list page, and
 *  a 7-line pure function isn't worth widening that surface — keep the two
 *  copies in sync if the formatting rules ever change. */
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCount(count: number): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return compactNumber.format(safeCount);
}
