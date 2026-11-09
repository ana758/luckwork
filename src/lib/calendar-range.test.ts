import { describe, expect, it } from "vitest";
import { fiveWeekdays, sevenCalendarDays } from "./calendar-range";

describe("calendar week views", () => {
  it("shows only Monday through Friday in the five-day view", () => {
    const days = fiveWeekdays(new Date(2026, 10, 21));
    expect(days.map((day) => day.getDate())).toEqual([16, 17, 18, 19, 20]);
    expect(days.map((day) => day.getDay())).toEqual([1, 2, 3, 4, 5]);
  });

  it("includes Saturday November 21 and Sunday November 22 in the seven-day view", () => {
    const days = sevenCalendarDays(new Date(2026, 10, 21));
    expect(days.map((day) => day.getDate())).toEqual([16, 17, 18, 19, 20, 21, 22]);
    expect(days.map((day) => day.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("advances both ranges to the next week across a month boundary", () => {
    const cursor = new Date(2026, 10, 30);
    cursor.setDate(cursor.getDate() + 7);
    expect(fiveWeekdays(cursor).map((day) => day.getDate())).toEqual([7, 8, 9, 10, 11]);
    expect(sevenCalendarDays(cursor).map((day) => day.getDate())).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });
});