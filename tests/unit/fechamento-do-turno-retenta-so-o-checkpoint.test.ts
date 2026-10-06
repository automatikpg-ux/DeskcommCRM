import { describe, expect, it, vi } from "vitest";

import {
  fecharComRetentativa,
  TENTATIVAS_DO_FECHAMENTO,
} from "@/lib/agent-engine/agent/inbound-turn";

const VALIDO = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "Lead perguntou da velocidade da bike.",
});

describe("fecharComRetentativa", () => {
  it("JSON válido de primeira: uma chamada só", async () => {
    const pedir = vi.fn(async () => VALIDO);
    const r = await fecharComRetentativa(pedir);
    expect(r.rolling_summary).toBe("Lead perguntou da velocidade da bike.");
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("JSON malformado: pede de novo SÓ o fechamento e aceita o seguinte", async () => {
    const pedir = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('{"commitments": [], "objections": [,]}')
      .mockResolvedValueOnce(VALIDO);
    const recusas: number[] = [];
    const r = await fecharComRetentativa(pedir, (t) => recusas.push(t));
    expect(r.next_action).toBeNull();
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(recusas).toEqual([1]);
  });

  it("shape errado também conta como recusa", async () => {
    const pedir = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('{"commitments": "não é lista"}')
      .mockResolvedValueOnce(VALIDO);
    await fecharComRetentativa(pedir);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("esgotadas as tentativas, lança o erro do parse (o job re-tenta como antes)", async () => {
    const pedir = vi.fn(async () => "sem json nenhum");
    await expect(fecharComRetentativa(pedir)).rejects.toThrow(/sem JSON de checkpoint/);
    expect(pedir).toHaveBeenCalledTimes(TENTATIVAS_DO_FECHAMENTO);
  });

  it("falha da CHAMADA (rede, provedor) não é re-tentada aqui", async () => {
    const pedir = vi.fn(async () => {
      throw new Error("provedor fora do ar");
    });
    await expect(fecharComRetentativa(pedir)).rejects.toThrow("provedor fora do ar");
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});
