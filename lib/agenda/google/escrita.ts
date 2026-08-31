/**
 * A IDA — escrever no Google o que foi marcado aqui.
 *
 * ═══ O buraco que este arquivo fecha ═══
 *
 * O item pedido é "sync IDA E VOLTA". A VOLTA existe inteira (`eventos-remotos`,
 * `evento.doEventoDoGoogle`, o cron de sync). A IDA não tinha uma linha:
 *
 *     grep -rn "paraEventoDoGoogle" app lib workers components hooks
 *     # 2 linhas, AMBAS dentro de lib/agenda/google/evento.ts = ZERO call sites
 *     grep -rn 'method: "' lib/agenda/google/*.ts
 *     # 1 linha: token.ts (a troca OAuth) — nenhuma escrita de evento
 *
 * O tradutor estava escrito, testado e na prateleira. O schema também: a
 * `calendar_appointments` já tem `google_event_id`, `google_ical_uid`,
 * `google_sequence`, `google_synced_at` e `google_sync_error`. E o filtro
 * anti-eco do worker de leitura (`ehIcalUidNosso`) já pressupunha exatamente o
 * que não estava implementado — ele existia para ignorar eventos que nós
 * criaríamos, e nós nunca criávamos nenhum.
 *
 * ═══ POST para criar, PUT para atualizar — e a premissa que estava errada ═══
 *
 * ⚠️ ESTE PARÁGRAFO AFIRMAVA QUE `events.update` CRIA NUM ID QUE NÃO EXISTE.
 * **É FALSO, e custou a sincronização inteira.** Medido na VPS do dono (v1.9.1):
 * o cron devolveu `{"candidatos":3,"publicados":0,"falhas":3}` e as três linhas
 * gravaram `evento_sumiu: HTTP 404`. Nenhum compromisso jamais chegou ao Google,
 * e a tentativa se repetia a cada 5 minutos porque `google_event_id` continuava
 * nulo.
 *
 * O que a documentação oficial sustenta (conferido, não lembrado):
 *
 *   `events.insert` (POST) ACEITA o `id` no corpo — base32hex (a-v, 0-9), de 5 a
 *   1024 caracteres, único por calendário. É o que preserva a idempotência do id
 *   derivado.
 *     https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
 *
 *   Id que já existe devolve **409 `duplicate`**, e a ação que a própria doc
 *   sugere é: *"use the `events.update` method"*.
 *     https://developers.google.com/workspace/calendar/api/guides/errors
 *
 *   Sobre `events.update` exigir evento existente, a doc **não afirma nada** — o
 *   que a sustenta é o 404 do guia de erros ("has never existed") mais a medição
 *   da VPS. E upsert nativo numa chamada só: NÃO EXISTE na doc.
 *
 * Então o caminho é: POST primeiro; se 409, PUT. Que é o que está abaixo.
 *
 * ⚠️ E A DOC NÃO GARANTE O 409: *"we cannot guarantee that ID collisions will be
 * detected at event creation time"*. Por isso o POST só é tentado quando NÃO
 * temos `google_event_id` guardado — quem já foi publicado vai direto de PUT, e
 * não depende de uma colisão ser detectada para não duplicar.
 *
 * O id do Google aceita apenas [a-v0-9] e no mínimo 5 caracteres — mas ver o
 * addendum abaixo: aceitar no FORMATO não é aceitar na PRÁTICA, em toda conta.
 *
 * ═══ ADDENDUM — id customizado NÃO é universal, e custou a ida DE NOVO ═══
 *
 * ⚠️ O PARÁGRAFO ACIMA TAMBÉM ESTAVA INCOMPLETO. Medido numa conta Gmail
 * pessoal (não-Workspace) real: `events.insert` com `id` no corpo — no formato
 * certo, `[a-v0-9]{5,1024}`, testado com 3 valores diferentes, um deles de 5
 * caracteres — devolve **400 "Invalid resource id value."** sempre. Remover o
 * `id` do corpo (deixando o Google atribuir) e mandar o MESMO resto do
 * payload funciona na hora, 200.
 *
 * A doc de `events.insert` documenta o campo `id` como aceito, e é verdade —
 * só não garante que toda conta o honre. Contas Workspace historicamente têm
 * suporte mais consistente a id customizado que contas Gmail pessoais; esta
 * instalação usa uma conta pessoal.
 *
 * Então o id customizado sai de vez, e com ele a lógica de detectar 409 e
 * cair para PUT (não há mais id nosso para colidir). A idempotência que
 * aquele mecanismo dava — evitar duplicata quando o Google cria o evento mas
 * a escrita do `google_event_id` aqui falha antes de terminar — passa a vir
 * de buscar por `iCalUID` (que É determinístico, gerado por nós, e sobrevive
 * ao crash) antes de decidir POST vs PUT.
 *
 * E o DELETE, que reconstruía o mesmo id derivado, agora recebe o
 * `google_event_id` REAL guardado na linha — sem id customizado no Google, o
 * id derivado nunca correspondeu a nada de verdade lá, e um DELETE nele
 * devolveria 404 (lido como "já está feito") enquanto o evento real ficava
 * órfão na agenda pessoal de quem atende.
 */
import { classificarErroDoGoogle, type ClassificacaoDoErro } from "./erros";
import { paraEventoDoGoogle, type AgendamentoParaGoogle } from "./evento";

const ENDERECO_DE_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars";
const PRAZO_MS = 15_000;

export type EscritaNoGoogle =
  | { ok: true; eventoId: string; sequence: number | null }
  | { ok: false; classificacao: ClassificacaoDoErro; detalhe: string };

async function chamar(
  metodo: "POST" | "PUT" | "DELETE",
  accessToken: string,
  calendarId: string,
  eventoId: string | null,
  corpo?: unknown,
): Promise<Response> {
  // POST vai para a COLEÇÃO (`/events`) e leva o id no CORPO; PUT e DELETE vão
  // para o RECURSO (`/events/{id}`). Misturar os dois é o que produziria um
  // `PUT /events` sem id, que o Google recusa por outro motivo — e o erro
  // apontaria para o lugar errado.
  const base = `${ENDERECO_DE_EVENTOS}/${encodeURIComponent(calendarId)}/events`;
  const url = eventoId === null ? base : `${base}/${encodeURIComponent(eventoId)}`;
  return fetch(url, {
    method: metodo,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(corpo === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    signal: AbortSignal.timeout(PRAZO_MS),
    cache: "no-store",
  });
}

/**
 * Procura um evento já existente pelo `iCalUID` — a rede de segurança contra
 * duplicata que o id customizado dava (ver addendum no cabeçalho do arquivo).
 * Cobre o caso em que uma publicação anterior criou o evento no Google mas a
 * gravação do `google_event_id` na nossa linha não completou: sem isto, a
 * próxima rodada criaria um SEGUNDO evento, porque não há mais id nosso para
 * o Google detectar como duplicata na criação.
 *
 * Falha na BUSCA nunca bloqueia a escrita — `null` só significa "não achei ou
 * não consegui perguntar", e o chamador segue para POST. Pior caso de uma
 * busca que falhou é uma duplicata rara; travar a sincronização por causa da
 * proteção contra duplicata é pior que o problema que ela evita.
 */
async function buscarPorICalUID(
  accessToken: string,
  calendarId: string,
  icalUid: string,
): Promise<string | null> {
  const url = `${ENDERECO_DE_EVENTOS}/${encodeURIComponent(calendarId)}/events?iCalUID=${encodeURIComponent(icalUid)}`;
  try {
    const resposta = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: "no-store",
    });
    if (!resposta.ok) return null;
    const corpo = (await resposta.json().catch(() => ({}))) as {
      items?: Array<{ id?: string; status?: string }>;
    };
    const encontrado = (corpo.items ?? []).find(
      (e) => typeof e.id === "string" && e.id && e.status !== "cancelled",
    );
    return encontrado?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Cria OU atualiza o evento — com o verbo certo para cada caso.
 *
 * `googleEventId` é o que o chamador JÁ tem guardado na linha
 * (`calendar_appointments.google_event_id`). Sem ele, busca por `iCalUID`
 * antes de criar (ver `buscarPorICalUID`) — só cai para POST se nem isso achar
 * nada.
 *
 *   `googleEventId` guardado, ou achado por iCalUID → PUT (atualiza)
 *   nenhum dos dois                                  → POST (cria; sem `id`
 *                                                       no corpo — ver
 *                                                       addendum no cabeçalho)
 */
export async function publicarNoGoogle(
  accessToken: string,
  calendarId: string,
  agendamento: AgendamentoParaGoogle,
  googleEventId?: string | null,
): Promise<EscritaNoGoogle> {
  const corpoDoEvento = paraEventoDoGoogle(agendamento);

  let eventoId =
    typeof googleEventId === "string" && googleEventId.length > 0 ? googleEventId : null;
  if (eventoId === null) {
    eventoId = await buscarPorICalUID(accessToken, calendarId, corpoDoEvento.iCalUID);
  }
  const jaExisteLa = eventoId !== null;

  let resposta: Response;
  try {
    resposta = await chamar(jaExisteLa ? "PUT" : "POST", accessToken, calendarId, eventoId, corpoDoEvento);
  } catch (erro) {
    return {
      ok: false,
      classificacao: classificarErroDoGoogle(erro, "sincronizar"),
      detalhe: erro instanceof Error ? erro.message : String(erro),
    };
  }

  if (!resposta.ok) {
    const cru = await resposta.json().catch(() => ({ status: resposta.status }));
    return {
      ok: false,
      // A OPERAÇÃO diz ao classificador como ler o 404, e as duas leituras são
      // opostas: num PUT de evento que tínhamos, 404 é "existia e sumiu" e pede
      // reconciliação; num POST, o evento nunca existiu e 404 só pode ser o
      // CALENDÁRIO que não existe. Classificar os dois como `evento_sumiu` foi o
      // que fez a VPS registrar três vezes um diagnóstico que não descrevia nada.
      classificacao: classificarErroDoGoogle(cru, jaExisteLa ? "sincronizar" : "criar"),
      detalhe: `HTTP ${resposta.status}`,
    };
  }
  const corpo = (await resposta.json().catch(() => ({}))) as { id?: string; sequence?: number };
  if (typeof corpo.id !== "string" || !corpo.id) {
    // 2xx sem id no corpo não deveria acontecer — mas sem id customizado não
    // há mais um derivado para cair como fallback, então isto é erro, não
    // resposta parcial silenciosa.
    return {
      ok: false,
      classificacao: classificarErroDoGoogle({ status: resposta.status }, jaExisteLa ? "sincronizar" : "criar"),
      detalhe: "resposta 2xx do Google sem id do evento",
    };
  }
  return {
    ok: true,
    eventoId: corpo.id,
    sequence: typeof corpo.sequence === "number" ? corpo.sequence : null,
  };
}

/**
 * Apaga o evento lá. Cancelar aqui tem de sumir de lá — senão o horário segue
 * bloqueado na agenda pessoal de quem atende, e o efeito é o oposto do pedido.
 *
 * `eventoId` é o `google_event_id` REAL guardado na linha — nunca re-derivado
 * do id do agendamento (ver addendum no cabeçalho do arquivo). Sem id
 * customizado no Google, um id re-derivado não corresponde a nada de
 * verdade lá: o DELETE devolveria 404, seria lido como "já está feito", e o
 * evento real ficaria órfão na agenda da pessoa. Quem chama sem
 * `google_event_id` nenhum (nunca chegou a sincronizar) não tem o que apagar
 * no Google — nem deveria chamar esta função.
 *
 * ⚠️ 404 e 410 são SUCESSO. O evento não existe mais: é exatamente o estado que
 * se queria. Tratá-los como erro faria o worker reencher a Central de avisos com
 * uma falha que não é falha — e o `classificarErroDoGoogle` já nomeia isso como
 * `ja_esta_feito`.
 */
export async function apagarNoGoogle(
  accessToken: string,
  calendarId: string,
  eventoId: string,
): Promise<EscritaNoGoogle> {
  let resposta: Response;
  try {
    resposta = await chamar("DELETE", accessToken, calendarId, eventoId);
  } catch (erro) {
    return {
      ok: false,
      classificacao: classificarErroDoGoogle(erro, "apagar"),
      detalhe: erro instanceof Error ? erro.message : String(erro),
    };
  }
  if (resposta.ok || resposta.status === 404 || resposta.status === 410) {
    return { ok: true, eventoId, sequence: null };
  }
  const cru = await resposta.json().catch(() => ({ status: resposta.status }));
  return {
    ok: false,
    classificacao: classificarErroDoGoogle(cru, "apagar"),
    detalhe: `HTTP ${resposta.status}`,
  };
}
