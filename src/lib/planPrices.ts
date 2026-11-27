// Pure price maths for the plans page (kept apart from lib/pro so tests can load it).

// Yearly against twelve months of monthly, as a whole percent rounded down,
// never up.
export function yearlySavingPercent(monthlyCents: number, yearlyCents: number): number {
  if (monthlyCents <= 0) return 0;
  return Math.max(0, Math.floor((1 - yearlyCents / (monthlyCents * 12)) * 100));
}
