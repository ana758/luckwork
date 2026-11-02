import { describe, expect, it } from "vitest";
import { isMeetingLike } from "./sources";

describe("isMeetingLike — regra do LUCK: reunião é reunião em qualquer aba", () => {
  it("marca reunião pelo nome", () => {
    expect(isMeetingLike("Reunião com Carlos Dias")).toBe(true);
    expect(isMeetingLike("reuniao angi 11:00 duração 1:30")).toBe(true);
    expect(isMeetingLike("REUNIÃO Apresentação Angi – Lucas")).toBe(true);
    expect(isMeetingLike("Call com fornecedor")).toBe(true);
    expect(isMeetingLike("meeting urbantech")).toBe(true);
  });

  it("ignora acento e pontuação", () => {
    expect(isMeetingLike("reunião")).toBe(true);
    expect(isMeetingLike("reuniões da semana")).toBe(true);
  });

  it("tarefa sobre reunião NÃO é vermelha", () => {
    expect(isMeetingLike("confirmar com Rhaner horário da reunião com Lucas")).toBe(false);
    expect(isMeetingLike("avisar mari mudanca de dia da reuniao")).toBe(false);
    expect(isMeetingLike("preparar reunião tininha")).toBe(false);
    expect(isMeetingLike("Marcar reunião com todas as pessoas que a Malu mandou")).toBe(false);
    expect(isMeetingLike("ver mateus que dia da reunião - bahia")).toBe(false);
  });

  it("título vazio não é reunião", () => {
    expect(isMeetingLike("")).toBe(false);
    expect(isMeetingLike(null)).toBe(false);
  });
});
