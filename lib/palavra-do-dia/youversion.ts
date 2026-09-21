/**
 * Adaptador da API da YouVersion — a fonte de conteúdo da "Palavra do Dia".
 *
 * ✅ CONTRATO VERIFICADO com chamada real (2026-09-21), contra a chave da
 * própria conta do parceiro:
 *
 *   1. GET {base}/verse_of_the_days/{dia_do_ano}   → { day, passage_id }
 *   2. GET {base}/bibles/{bible_id}/passages/{passage_id}?format=text
 *                                                   → { id, content, reference }
 *
 * `dia_do_ano` é 1–366 (dia juliano do calendário, mesmo dia para toda
 * organização que usar o mesmo fuso — quem chama já resolve isso com
 * `diaDoAnoLocal`). `bible_id` é o id numérico da tradução (129 = NVI
 * pt-BR, confirmado consultando `GET /bibles?language_ranges[]=por`).
 * Autenticação por header `X-YVP-App-Key` (não é Bearer). Base URL real:
 * `https://api.youversion.com/v1` — o domínio `developers.youversionapi.com`
 * que uma versão anterior deste arquivo chutava não resolve no DNS.
 */

/** O que o resto do produto precisa do versículo do dia — já pronto para o template. */
export interface PalavraDoDia {
  referencia: string; // ex.: "Deuteronômio 7:9"
  texto: string; // ex.: "Saibam, portanto, que o Senhor, o seu Deus, é Deus..."
  versao: string; // ex.: "NVI"
}

export class YouVersionConfigError extends Error {}
export class YouVersionRequestError extends Error {}

interface ConfigYouVersion {
  apiKey: string;
  baseUrl: string;
  bibleId: string;
  versaoLabel: string;
}

/** Lê a config do ambiente. Lança `YouVersionConfigError` se faltar a chave — quem chama decide se isso derruba a rodada ou só pula a organização. */
export function configDoAmbiente(env: {
  YOUVERSION_API_KEY?: string;
  YOUVERSION_API_BASE_URL?: string;
  YOUVERSION_BIBLE_ID?: string;
  YOUVERSION_VERSAO_LABEL?: string;
}): ConfigYouVersion {
  const apiKey = env.YOUVERSION_API_KEY?.trim() ?? "";
  const baseUrl = env.YOUVERSION_API_BASE_URL?.trim() || "https://api.youversion.com/v1";
  const bibleId = env.YOUVERSION_BIBLE_ID?.trim() || "129"; // NVI — Nova Versão Internacional (pt-BR)
  const versaoLabel = env.YOUVERSION_VERSAO_LABEL?.trim() || "NVI";
  if (!apiKey) throw new YouVersionConfigError("YOUVERSION_API_KEY ausente.");
  return { apiKey, baseUrl, bibleId, versaoLabel };
}

/** O dia juliano (1–366) do calendário local — o mesmo índice usado pelo catálogo `verse_of_the_days` da YouVersion. */
export function diaDoAnoLocal(dataLocalISO: string): number {
  const partes = dataLocalISO.split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  const inicioDoAno = Date.UTC(ano, 0, 1);
  const hoje = Date.UTC(ano, mes - 1, dia);
  return Math.floor((hoje - inicioDoAno) / 86_400_000) + 1;
}

interface RespostaVerseOfTheDay {
  day: number;
  passage_id: string;
}

interface RespostaPassage {
  id: string;
  content: string;
  reference: string;
}

/** Extrai o formato canônico a partir das duas respostas cruas — separado para ser testável sem rede. */
export function extrairVerso(passage: RespostaPassage, versaoLabel: string): PalavraDoDia {
  const referencia = passage.reference?.trim();
  const texto = passage.content?.trim();
  if (!referencia || !texto) {
    throw new YouVersionRequestError(
      "Resposta da YouVersion não trouxe reference/content — confira se o contrato mudou.",
    );
  }
  return { referencia, texto, versao: versaoLabel };
}

async function chamar<T>(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
): Promise<T> {
  const resposta = await fetchImpl(url, {
    headers: { "X-YVP-App-Key": apiKey, Accept: "application/json" },
  });
  if (!resposta.ok) {
    throw new YouVersionRequestError(`YouVersion respondeu ${resposta.status}: ${await resposta.text()}`);
  }
  return (await resposta.json()) as T;
}

/** `404` da YouVersion para uma referência que não existe (livro/capítulo/versículo errado). */
export class YouVersionPassageNotFoundError extends YouVersionRequestError {}

async function buscarPassagem<T>(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
): Promise<T> {
  const resposta = await fetchImpl(url, {
    headers: { "X-YVP-App-Key": apiKey, Accept: "application/json" },
  });
  if (resposta.status === 404) {
    throw new YouVersionPassageNotFoundError(`YouVersion não encontrou a passagem (404): ${await resposta.text()}`);
  }
  if (!resposta.ok) {
    throw new YouVersionRequestError(`YouVersion respondeu ${resposta.status}: ${await resposta.text()}`);
  }
  return (await resposta.json()) as T;
}

/**
 * Busca UMA passagem específica pelo id USX (ex.: "PSA.115.16", ou uma faixa
 * "PSA.115.16-17" — confirmado contra a API real em 2026-09-21). Usa a MESMA
 * segunda chamada de `buscarPalavraDoDia`, sem o passo de `verse_of_the_days`
 * — quem já sabe a referência não precisa do catálogo do dia.
 *
 * Lança `YouVersionPassageNotFoundError` (subclasse de `YouVersionRequestError`)
 * quando a referência não existe (404 real, confirmado com PSA.115.999 e um
 * livro inventado) — quem chama decide se isso vira "não encontrei" pro
 * usuário ou erro de verdade.
 */
export async function buscarPassagemPorId(
  env: Parameters<typeof configDoAmbiente>[0],
  passageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PalavraDoDia> {
  const config = configDoAmbiente(env);
  const passage = await buscarPassagem<RespostaPassage>(
    fetchImpl,
    `${config.baseUrl}/bibles/${config.bibleId}/passages/${encodeURIComponent(passageId)}?format=text`,
    config.apiKey,
  );
  return extrairVerso(passage, config.versaoLabel);
}

/**
 * Busca o versículo do dia (duas chamadas: o catálogo `verse_of_the_days` dá o
 * `passage_id` do dia, e `bibles/{id}/passages/{passage_id}` traz o texto na
 * tradução escolhida). Uma vez por organização por dia local — quem chama já
 * garante isso via `eHoraDaVarredura` — nunca uma por membro.
 */
export async function buscarPalavraDoDia(
  env: Parameters<typeof configDoAmbiente>[0],
  dataLocalISO: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PalavraDoDia> {
  const config = configDoAmbiente(env);
  const dia = diaDoAnoLocal(dataLocalISO);

  const votd = await chamar<RespostaVerseOfTheDay>(
    fetchImpl,
    `${config.baseUrl}/verse_of_the_days/${dia}`,
    config.apiKey,
  );
  const passage = await chamar<RespostaPassage>(
    fetchImpl,
    `${config.baseUrl}/bibles/${config.bibleId}/passages/${encodeURIComponent(votd.passage_id)}?format=text`,
    config.apiKey,
  );
  return extrairVerso(passage, config.versaoLabel);
}
