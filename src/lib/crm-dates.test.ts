import { describe, expect, it } from "vitest";
import { crmScheduleDates, crmTaskTitle, isInteractionClosed, isTerminalStage } from "./crm-dates";

describe("crmScheduleDates", () => {
  it("usa o início, não a data do update", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", when: "2026-10-19" })).toEqual({ start: "2026-11-03", due: null });
  });
  it("não agenda pela data antiga ambígua do update", () => {
    expect(crmScheduleDates({ when: "2026-10-19" }).start).toBeNull();
  });
  it("repete somente no prazo final", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", due_date: "2026-11-06" })).toEqual({ start: "2026-11-03", due: "2026-11-06" });
  });
  it("não duplica quando prazo final é o mesmo dia", () => {
    expect(crmScheduleDates({ start_date: "2026-11-03", due_date: "2026-11-03" }).due).toBeNull();
  });
});

describe("regras CRM", () => {
  it("título é lead · nota exata", () => {
    expect(crmTaskTitle("Rafael Aspen", "Chamar pos eleição")).toBe("Rafael Aspen · Chamar pos eleição");
  });
  it("Ganho e Perdido são terminais; On hold não", () => {
    expect(isTerminalStage("Ganho")).toBe(true);
    expect(isTerminalStage("Perdido / Sem Retorno")).toBe(true);
    expect(isTerminalStage("On hold")).toBe(false);
  });
  it("excluída ou concluída fecha a tarefa", () => {
    expect(isInteractionClosed({ deleted: true })).toBe(true);
    expect(isInteractionClosed({ status: "Concluída" })).toBe(true);
    expect(isInteractionClosed({ status: "Em Andamento" })).toBe(false);
  });
});
