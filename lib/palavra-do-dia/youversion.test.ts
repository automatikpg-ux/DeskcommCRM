import { describe, expect, it, vi } from "vitest";
import {
  buscarPalavraDoDia,
  buscarPassagemPorId,
  configDoAmbiente,
  diaDoAnoLocal,
  extrairVerso,
  YouVersionConfigError,
  YouVersionPassageNotFoundError,
  YouVersionRequestError,
} from "./youversion";

describe("configDoAmbiente", () => {
  it("lança YouVersionConfigError sem API key", () => {
    expect(() => configDoAmbiente({})).toThrow(YouVersionConfigError);
  });

  it("usa defaults de base URL, bíblia e rótulo quando não informados", () => {
    const config = configDoAmbiente({ YOUVERSION_API_KEY: "chave" });
    expect(config.apiKey).toBe("chave");
    expect(config.baseUrl).toBe("https://api.youversion.com/v1");
    expect(config.bibleId).toBe("129");
    expect(config.versaoLabel).toBe("NVI");
  });

  it("respeita overrides", () => {
    const config = configDoAmbiente({
      YOUVERSION_API_KEY: "chave",
      YOUVERSION_API_BASE_URL: "https://exemplo.test",
      YOUVERSION_BIBLE_ID: "1966",
      YOUVERSION_VERSAO_LABEL: "NBV-P",
    });
    expect(config.baseUrl).toBe("https://exemplo.test");
    expect(config.bibleId).toBe("1966");
    expect(config.versaoLabel).toBe("NBV-P");
  });
});

describe("diaDoAnoLocal", () => {
  it("1º de janeiro é o dia 1", () => {
    expect(diaDoAnoLocal("2026-01-01")).toBe(1);
  });

  it("21 de setembro de 2026 é o dia 264 (confirmado contra a API real)", () => {
    expect(diaDoAnoLocal("2026-09-21")).toBe(264);
  });

  it("31 de dezembro de um ano não bissexto é o dia 365", () => {
    expect(diaDoAnoLocal("2026-12-31")).toBe(365);
  });
});

describe("extrairVerso", () => {
  it("lê {id, content, reference} — o formato real confirmado contra a API", () => {
    const verso = extrairVerso(
      { id: "DEU.7.9", content: "Saibam, portanto, que o Senhor...", reference: "Deuteronômio 7:9" },
      "NVI",
    );
    expect(verso).toEqual({
      referencia: "Deuteronômio 7:9",
      texto: "Saibam, portanto, que o Senhor...",
      versao: "NVI",
    });
  });

  it("apara espaço em volta do texto e da referência", () => {
    const verso = extrairVerso({ id: "X", content: "  com espaço  ", reference: "  Ref  " }, "NVI");
    expect(verso.texto).toBe("com espaço");
    expect(verso.referencia).toBe("Ref");
  });

  it("lança YouVersionRequestError quando falta content ou reference", () => {
    expect(() => extrairVerso({ id: "X", content: "", reference: "Ref" }, "NVI")).toThrow(
      YouVersionRequestError,
    );
    expect(() => extrairVerso({ id: "X", content: "Texto", reference: "" }, "NVI")).toThrow(
      YouVersionRequestError,
    );
  });
});

describe("buscarPalavraDoDia", () => {
  it("encadeia verse_of_the_days → bibles/passages e monta o resultado final", async () => {
    const chamadas: string[] = [];
    const fetchFalso = vi.fn(async (url: string) => {
      chamadas.push(url);
      if (url.includes("/verse_of_the_days/")) {
        return new Response(JSON.stringify({ day: 264, passage_id: "DEU.7.9" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ id: "DEU.7.9", content: "Texto do versículo.", reference: "Deuteronômio 7:9" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const verso = await buscarPalavraDoDia({ YOUVERSION_API_KEY: "chave" }, "2026-09-21", fetchFalso);

    expect(verso).toEqual({ referencia: "Deuteronômio 7:9", texto: "Texto do versículo.", versao: "NVI" });
    expect(chamadas[0]).toBe("https://api.youversion.com/v1/verse_of_the_days/264");
    expect(chamadas[1]).toBe("https://api.youversion.com/v1/bibles/129/passages/DEU.7.9?format=text");
  });

  it("lança YouVersionRequestError quando a API responde erro", async () => {
    const fetchFalso = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      buscarPalavraDoDia({ YOUVERSION_API_KEY: "chave" }, "2026-09-21", fetchFalso),
    ).rejects.toThrow(YouVersionRequestError);
  });
});

describe("buscarPassagemPorId", () => {
  it("busca uma passagem direto pelo id, sem passar por verse_of_the_days — contrato confirmado com PSA.115.16 real", async () => {
    const chamadas: string[] = [];
    const fetchFalso = vi.fn(async (url: string) => {
      chamadas.push(url);
      return new Response(
        JSON.stringify({
          id: "PSA.115.16",
          content: "Os mais altos céus pertencem ao Senhor, mas a terra, ele a confiou à humanidade.",
          reference: "Salmos 115:16",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const verso = await buscarPassagemPorId({ YOUVERSION_API_KEY: "chave" }, "PSA.115.16", fetchFalso);

    expect(verso).toEqual({
      referencia: "Salmos 115:16",
      texto: "Os mais altos céus pertencem ao Senhor, mas a terra, ele a confiou à humanidade.",
      versao: "NVI",
    });
    expect(chamadas).toEqual(["https://api.youversion.com/v1/bibles/129/passages/PSA.115.16?format=text"]);
  });

  it("aceita faixa de versículos no id — contrato confirmado com PSA.115.16-17 real", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "PSA.115.16-17",
          content: "Os mais altos céus... Os mortos não louvam ao Senhor...",
          reference: "Salmos 115:16-17",
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const verso = await buscarPassagemPorId({ YOUVERSION_API_KEY: "chave" }, "PSA.115.16-17", fetchFalso);
    expect(verso.referencia).toBe("Salmos 115:16-17");
  });

  it("lança YouVersionPassageNotFoundError num 404 — confirmado com PSA.115.999 real", async () => {
    const fetchFalso = vi.fn(
      async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      buscarPassagemPorId({ YOUVERSION_API_KEY: "chave" }, "PSA.115.999", fetchFalso),
    ).rejects.toThrow(YouVersionPassageNotFoundError);
  });

  it("lança YouVersionRequestError, mas não a subclasse NotFound, em outros erros", async () => {
    const fetchFalso = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    let erro: unknown;
    try {
      await buscarPassagemPorId({ YOUVERSION_API_KEY: "chave" }, "PSA.115.16", fetchFalso);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(YouVersionRequestError);
    expect(erro).not.toBeInstanceOf(YouVersionPassageNotFoundError);
  });
});
