import { describe, expect, it } from "vitest";
import { diaLocal, eHoraDaVarredura, fusoDaOrganizacao } from "./agendamento";

describe("fusoDaOrganizacao", () => {
  it("usa o fuso da organização quando informado", () => {
    expect(fusoDaOrganizacao("America/Recife")).toBe("America/Recife");
  });

  it("cai no padrão quando ausente, vazio ou só espaço", () => {
    expect(fusoDaOrganizacao(null)).toBe("America/Sao_Paulo");
    expect(fusoDaOrganizacao(undefined)).toBe("America/Sao_Paulo");
    expect(fusoDaOrganizacao("  ")).toBe("America/Sao_Paulo");
  });
});

describe("eHoraDaVarredura", () => {
  it("bate quando a hora local é exatamente a hora marcada", () => {
    // 07:00 em São Paulo (UTC-3) é 10:00 UTC.
    const agora = new Date("2026-09-21T10:00:00Z");
    expect(eHoraDaVarredura(agora, "America/Sao_Paulo", 7)).toBe(true);
  });

  it("não bate em outra hora", () => {
    const agora = new Date("2026-09-21T11:00:00Z");
    expect(eHoraDaVarredura(agora, "America/Sao_Paulo", 7)).toBe(false);
  });
});

describe("diaLocal", () => {
  it("lê o dia no fuso da organização, não o UTC", () => {
    // 21h de 21/09 em São Paulo já é 22/09 em UTC.
    const agora = new Date("2026-09-22T00:30:00Z");
    expect(diaLocal(agora, "America/Sao_Paulo")).toBe("2026-09-21");
  });
});
