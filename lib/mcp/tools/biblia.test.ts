import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as YouVersionModule from "@/lib/palavra-do-dia/youversion";

vi.mock("@/lib/palavra-do-dia/youversion", async () => {
  const real = await vi.importActual<typeof YouVersionModule>("@/lib/palavra-do-dia/youversion");
  return { ...real, buscarPassagemPorId: vi.fn() };
});

import { buscarPassagemPorId, YouVersionPassageNotFoundError } from "@/lib/palavra-do-dia/youversion";
import { crmSearchBibleVerse } from "./biblia";
import type { McpContext } from "../types";

const buscarMock = vi.mocked(buscarPassagemPorId);

/** O handler não usa `ctx` — o cast só satisfaz o tipo do parâmetro. */
const ctxVazio = {} as unknown as McpContext;

describe("crm_search_bible_verse", () => {
  beforeEach(() => {
    buscarMock.mockClear();
  });

  it("devolve o versículo quando a referência existe", async () => {
    buscarMock.mockResolvedValueOnce({
      referencia: "Salmos 115:16",
      texto: "Os mais altos céus pertencem ao Senhor...",
      versao: "NVI",
    });

    const resultado = (await crmSearchBibleVerse.handler(
      { livro: "Salmos", capitulo: 115, versiculo: 16 },
      ctxVazio,
    )) as Record<string, unknown>;

    expect(resultado).toEqual({
      encontrado: true,
      referencia: "Salmos 115:16",
      texto: "Os mais altos céus pertencem ao Senhor...",
      versao: "NVI",
    });
    expect(buscarMock).toHaveBeenCalledWith(expect.anything(), "PSA.115.16");
  });

  it("monta faixa de versículos quando versiculo_final é informado", async () => {
    buscarMock.mockResolvedValueOnce({ referencia: "Salmos 115:16-17", texto: "...", versao: "NVI" });

    await crmSearchBibleVerse.handler(
      { livro: "Salmos", capitulo: 115, versiculo: 16, versiculo_final: 17 },
      ctxVazio,
    );

    expect(buscarMock).toHaveBeenCalledWith(expect.anything(), "PSA.115.16-17");
  });

  it("recusa livro não reconhecido sem chamar a API", async () => {
    const resultado = (await crmSearchBibleVerse.handler(
      { livro: "Livro Inventado", capitulo: 1, versiculo: 1 },
      ctxVazio,
    )) as Record<string, unknown>;

    expect(resultado.encontrado).toBe(false);
    expect(resultado.motivo).toBe("livro_nao_reconhecido");
    expect(buscarMock).not.toHaveBeenCalled();
  });

  it("recusa faixa inválida (final menor que inicial) sem chamar a API", async () => {
    const resultado = (await crmSearchBibleVerse.handler(
      { livro: "Salmos", capitulo: 115, versiculo: 16, versiculo_final: 10 },
      ctxVazio,
    )) as Record<string, unknown>;

    expect(resultado.encontrado).toBe(false);
    expect(resultado.motivo).toBe("faixa_invalida");
    expect(buscarMock).not.toHaveBeenCalled();
  });

  it("devolve encontrado:false quando a referência não existe (404)", async () => {
    buscarMock.mockRejectedValueOnce(new YouVersionPassageNotFoundError("404"));

    const resultado = (await crmSearchBibleVerse.handler(
      { livro: "Salmos", capitulo: 115, versiculo: 999 },
      ctxVazio,
    )) as Record<string, unknown>;

    expect(resultado.encontrado).toBe(false);
    expect(resultado.motivo).toBe("referencia_nao_encontrada");
  });
});
