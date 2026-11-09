/** Five consecutive calendar days, including weekends, starting at the selected date. */
export function fiveCalendarDays(cursor: Date): Date[] {
  return Array.from({ length: 5 }, (_, offset) => {
    const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    day.setDate(day.getDate() + offset);
    return day;
  });
}