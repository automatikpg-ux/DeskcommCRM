import { describe, expect, it } from "vitest";
import { codigoDoLivro, montarPassageId } from "./livros";

describe("codigoDoLivro", () => {
  it("reconhece o nome completo, com acento", () => {
    expect(codigoDoLivro("Salmos")).toBe("PSA");
    expect(codigoDoLivro("Deuteronômio")).toBe("DEU");
    expect(codigoDoLivro("João")).toBe("JHN");
  });

  it("ignora acento, caixa e pontuação", () => {
    expect(codigoDoLivro("salmos")).toBe("PSA");
    expect(codigoDoLivro("SALMOS")).toBe("PSA");
    expect(codigoDoLivro("deuteronomio")).toBe("DEU");
  });

  it("reconhece livros numerados em variações comuns", () => {
    expect(codigoDoLivro("1 Coríntios")).toBe("1CO");
    expect(codigoDoLivro("1coríntios")).toBe("1CO");
    expect(codigoDoLivro("2 Timóteo")).toBe("2TI");
  });

  it("reconhece abreviações comuns", () => {
    expect(codigoDoLivro("sl")).toBe("PSA");
    expect(codigoDoLivro("dt")).toBe("DEU");
    expect(codigoDoLivro("jo")).toBe("JOB"); // "Jó", não "João"
  });

  it("devolve null para nome que não bate com nada", () => {
    expect(codigoDoLivro("Livro Inventado")).toBeNull();
    expect(codigoDoLivro("")).toBeNull();
  });
});

describe("montarPassageId", () => {
  it("monta id de um único versículo", () => {
    expect(montarPassageId("PSA", 115, 16)).toBe("PSA.115.16");
  });

  it("monta id de uma faixa quando versiculoFinal > versiculo", () => {
    expect(montarPassageId("PSA", 115, 16, 17)).toBe("PSA.115.16-17");
  });

  it("ignora versiculoFinal quando não é maior que o inicial", () => {
    expect(montarPassageId("PSA", 115, 16, 16)).toBe("PSA.115.16");
    expect(montarPassageId("PSA", 115, 16, 10)).toBe("PSA.115.16");
  });
});
