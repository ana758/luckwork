/** Monday through Sunday of the selected week, using local calendar dates. */
export function sevenCalendarDays(cursor: Date): Date[] {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    return day;
  });
}

/** Five-day view shows only Monday through Friday of the selected week. */
export function fiveWeekdays(cursor: Date): Date[] {
  return sevenCalendarDays(cursor).slice(0, 5);
}