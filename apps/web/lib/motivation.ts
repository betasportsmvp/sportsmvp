// Encouraging copy for attendance goals. Counts only; never money, rankings or pressure.

export function timesLabel(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n} times`;
}

export function weeklyMessage(played: number, target: number): string {
  if (played === 0) return `No games yet this week. Your goal is ${timesLabel(target)}.`;
  if (played >= target) return `You played ${timesLabel(played)} this week. Goal reached!`;
  return `You played ${timesLabel(played)} this week. ${target - played} more to reach your goal.`;
}

export function streakMessage(weeks: number): string | null {
  if (weeks < 2) return null;
  return `${weeks} weeks in a row at your goal.`;
}

export function groupMessage(played: number, target: number): string {
  const left = target - played;
  if (left <= 0) return `Your group reached its goal of ${target} sessions this month.`;
  return `Your group is ${left} session${left === 1 ? "" : "s"} from its goal of ${target} this month.`;
}
