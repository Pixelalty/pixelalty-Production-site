// Career levels use the administrator's fixed XP interval, with no artificial cap.
// Lifetime XP is the signed ledger total; corrections never rewrite past events.
export function careerProgress(total: number, interval = 250) {
  const xp = Math.max(0, Number.isFinite(total) ? Math.trunc(total) : 0);
  const step =
    Number.isFinite(interval) && interval > 0 ? Math.trunc(interval) : 250;
  const level = Math.floor(xp / step) + 1;
  const minimum = (level - 1) * step;
  const within = xp - minimum;
  return {
    xp,
    level,
    minimum,
    next: minimum + step,
    step,
    within,
    remaining: step - within,
    percent: (within / step) * 100,
  };
}
