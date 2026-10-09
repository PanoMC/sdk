/** Share of `raised` in `goal`, 0 to 100. */
export function percent(raised, goal) {
  return goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
}
