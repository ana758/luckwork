import { describe, expect, it } from "vitest";
import { crmScheduleDates } from "./crm-dates";

describe("crmScheduleDates", () => {
  it("usa o início, não a data do update", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", when: "2026-10-19" })).toEqual({ start: "2026-11-03", due: null });
  });
  it("não agenda pela data antiga ambígua do update", () => {
    expect(crmScheduleDates({ when: "2026-10-19" }).start).toBeNull();
  });
  it("repete somente no prazo final", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", due_date: "2026-11-10" })).toEqual({ start: "2026-11-03", due: "2026-11-10" });
  });
  it("não duplica quando prazo final é o mesmo dia", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", due_date: "2026-11-03" }).due).toBeNull();
  });
});