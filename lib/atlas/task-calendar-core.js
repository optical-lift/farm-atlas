export function addCalendarDaysCore(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveNextTaskDateCore(dueDate, todayIso) {
  const baseDate = dueDate && dueDate > todayIso ? dueDate : todayIso;
  return addCalendarDaysCore(baseDate, 1);
}
