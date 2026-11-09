import { describe, expect, it } from "vitest";
import { fiveCalendarDays } from "./calendar-range";

describe("fiveCalendarDays", () => {
  it("includes November 21, 2026 when selected, even though it is Saturday", () => {
    const days = fiveCalendarDays(new Date(2026, 10, 21));
    expect(days.map((day) => day.getDate())).toEqual([21, 22, 23, 24, 25]);
    expect(days[0].getDay()).toBe(6);
  });

  it("does not skip weekends when advancing by five days", () => {
    const first = new Date(2026, 10, 9);
    const days = Array.from({ length: 3 }, (_, index) => {
      const cursor = new Date(first);
      cursor.setDate(cursor.getDate() + index * 5);
      return fiveCalendarDays(cursor);
    }).flat();
    expect(days.map((day) => day.getDate())).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });
});