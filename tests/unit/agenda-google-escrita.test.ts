import { beforeEach, describe, expect, it, vi } from "vitest";

import { apagarNoGoogle, publicarNoGoogle } from "@/lib/agenda/google/escrita";
import type { AgendamentoParaGoogle } from "@/lib/agenda/google/evento";

/**
 * A IDA — e as três propriedades que ela precisa ter para não estragar a agenda
 * pessoal de quem atende.
 *
 * 1. IDEMPOTÊNCIA. Todo cron roda duas vezes algum dia. Se a segunda ida criar um
 *    segundo evento, o cliente vê a mesma consulta duplicada na agenda dele — e
 *    o horário fica bloqueado em dobro.
 * 2. APAGAR É "NÃO EXISTE MAIS", não "a chamada deu 200". 404 e 410 são o estado
 *    desejado; tratá-los como erro encheria a Central de aviso que não é falha.
 * 3. ERRO CLASSIFICADO, não engolido: o desfecho decide se o worker tenta de
 *    novo, rebaixa a conexão ou pede reautenticação.
 */

const AGENDAMENTO: AgendamentoParaGoogle = {
  id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  organization_id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Consulta",
  starts_at: "2026-09-02T13:00:00.000Z",
  ends_at: "2026-09-02T13:30:00.000Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  location_kind: "in_person",
};

function resposta(status: number, corpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("publicar", () => {
  /**
   * ⚠️ ESTE ARQUIVO JÁ MENTIU DUAS VEZES SOBRE O VERBO CERTO — as duas
   * primeiras versões estão no histórico do git, não repetidas aqui.
   *
   * A segunda mentira era exatamente o `id` customizado no corpo do POST, que
   * o cabeçalho de `lib/agenda/google/escrita.ts` documenta como aceito pela
   * doc oficial — e é verdade, só não é aceito por TODA conta. Medido numa
   * conta Gmail pessoal real: `events.insert` com `id` (formato certo,
   * `[a-v0-9]{5,1024}`, testado com 3 valores diferentes) devolve sempre
   * `400 "Invalid resource id value."`. Sem `id` no corpo, mesmo payload, 200.
   *
   * A propriedade que os dois testes antigos protegiam — reenviar não pode
   * duplicar — continua protegida, agora por busca de `iCalUID` antes de
   * decidir o verbo, em vez de por um id customizado que esta conta recusa.
   */
  it("sem google_event_id guardado, busca por iCalUID antes de decidir o verbo", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(200, { items: [] })) // busca: nada achado
      .mockResolvedValueOnce(resposta(200, { id: "novo-id-do-google", sequence: 0 }));
    const r = await publicarNoGoogle("tok", "ana@clinica.com.br", AGENDAMENTO);
    expect(r.ok).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);

    const [buscaUrl] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(buscaUrl).toContain("iCalUID=");

    const [criarUrl, criarInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(
      criarInit.method,
      "sem `google_event_id` e sem achado por iCalUID, o evento NÃO existe no " +
        "Google, e `PUT` num id inexistente devolve 404 — foi o que matou a ida na v1.9.1",
    ).toBe("POST");
    expect(criarUrl.endsWith("/events")).toBe(true);
  });

  it("o POST não leva `id` no corpo — esta conta recusa id customizado com 400", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(200, { items: [] }))
      .mockResolvedValueOnce(resposta(200, { id: "novo-id-do-google" }));
    await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    const [, criarInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    const corpo = JSON.parse(String(criarInit.body)) as { id?: string };
    expect(corpo.id, "id customizado no corpo — é o que reproduz o 400 medido").toBeUndefined();
  });

  it("achou o evento por iCalUID: usa PUT nele, não cria um segundo", async () => {
    // Cobre a publicação anterior que criou o evento no Google mas morreu
    // antes de gravar google_event_id aqui — sem isto, esta rodada duplicaria.
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(200, { items: [{ id: "achado-por-uid", status: "confirmed" }] }))
      .mockResolvedValueOnce(resposta(200, { id: "achado-por-uid", sequence: 1 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok).toBe(true);
    const [atualizarUrl, atualizarInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(atualizarInit.method, "achou por iCalUID — atualizar, nunca criar de novo").toBe("PUT");
    expect(atualizarUrl).toContain("achado-por-uid");
  });

  it("busca por iCalUID falhando não bloqueia — segue para POST mesmo assim", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(500, {})) // busca falhou
      .mockResolvedValueOnce(resposta(200, { id: "novo-id" }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok, "busca sem resposta clara não pode travar a escrita").toBe(true);
  });

  it("com google_event_id guardado, pula a busca e vai direto de PUT", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "jaexiste", sequence: 4 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "jaexiste");
    expect(r.ok).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method, "com id guardado, criar de novo é que duplicaria").toBe("PUT");
    expect(url).toContain("jaexiste");
  });

  it("404 ao CRIAR não é `evento_sumiu` — é o calendário que não existe", async () => {
    /**
     * As duas leituras do 404, que a v1.9.1 confundia numa só. Na criação a URL
     * é a coleção e não carrega id de evento nenhum: 404 ali só pode ser o
     * calendário. Dizer "o evento sumiu" manda quem lê procurar um evento — e o
     * que falta é o calendário. Consertos opostos: um pede reconciliar, o outro
     * reconectar.
     */
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(200, { items: [] }))
      .mockResolvedValueOnce(resposta(404, { error: { code: 404, message: "Not Found" } }));
    const r = await publicarNoGoogle("tok", "cal-que-nao-existe", AGENDAMENTO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.classificacao.desfecho).toBe("calendario_sumiu");
  });

  it("404 ao ATUALIZAR continua sendo `evento_sumiu` — tínhamos o id e ele se foi", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(404, { error: { code: 404, message: "Not Found" } }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "id-que-existia");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.classificacao.desfecho).toBe("evento_sumiu");
  });

  it("devolve o sequence que o Google mandou — é o que detecta edição alheia", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "x", sequence: 7 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "x");
    expect(r.ok && r.sequence).toBe(7);
  });

  it("erro do Google vira CLASSIFICAÇÃO, não exceção solta", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resposta(403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }),
    );
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "id-que-existia");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.classificacao.desfecho, "403 de escopo não pode virar retry infinito").toBe(
        "sem_permissao",
      );
    }
  });

  it("falha de REDE também é classificada — e é retentável", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "id-que-existia");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.classificacao.desfecho).toBe("transitorio");
  });
});

describe("apagar", () => {
  it("404 é SUCESSO — o evento não existe mais, que é o estado desejado", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(404, {}));
    const r = await apagarNoGoogle("tok", "cal", "google-event-real-id");
    expect(
      r.ok,
      "tratar 404 como erro encheria a Central de avisos com uma falha que não é falha",
    ).toBe(true);
  });

  it("410 também", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(410, {}));
    expect((await apagarNoGoogle("tok", "cal", "google-event-real-id")).ok).toBe(true);
  });

  it("CONTROLE: 500 NÃO é sucesso — senão o par acima passa por tolerar tudo", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(500, {}));
    expect((await apagarNoGoogle("tok", "cal", "google-event-real-id")).ok).toBe(false);
  });
});
