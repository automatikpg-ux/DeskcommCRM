/**
 * Nome do livro (como uma pessoa fala em português) → código USX de 3 letras
 * que a API da YouVersion espera no `passage_id` (ex.: "Salmos" → "PSA", pra
 * montar "PSA.115.16"). Contrato do código confirmado contra a API real: a
 * "Palavra do Dia" de 21/09/2026 devolveu "DEU.7.9" para Deuteronômio 7:9.
 *
 * A normalização (minúsculo, sem acento, sem pontuação) é o que permite "1
 * Coríntios", "1coríntios", "I Coríntios" e "1 Co" apontarem pro mesmo código
 * sem exigir que o modelo acerte a grafia exata.
 */

const MAPA_LIVRO_PARA_CODIGO: Readonly<Record<string, string>> = {
  // Antigo Testamento
  genesis: "GEN",
  gn: "GEN",
  exodo: "EXO",
  ex: "EXO",
  levitico: "LEV",
  lv: "LEV",
  numeros: "NUM",
  nm: "NUM",
  deuteronomio: "DEU",
  dt: "DEU",
  josue: "JOS",
  js: "JOS",
  juizes: "JDG",
  jz: "JDG",
  rute: "RUT",
  rt: "RUT",
  "1samuel": "1SA",
  "1sm": "1SA",
  "2samuel": "2SA",
  "2sm": "2SA",
  "1reis": "1KI",
  "1rs": "1KI",
  "2reis": "2KI",
  "2rs": "2KI",
  "1cronicas": "1CH",
  "1cr": "1CH",
  "2cronicas": "2CH",
  "2cr": "2CH",
  esdras: "EZR",
  ed: "EZR",
  neemias: "NEH",
  ne: "NEH",
  ester: "EST",
  et: "EST",
  jo: "JOB", // "Jó" normalizado — "João" tem chave própria ("joao"), não colide
  job: "JOB",
  salmos: "PSA",
  salmo: "PSA",
  sl: "PSA",
  proverbios: "PRO",
  pv: "PRO",
  eclesiastes: "ECC",
  ec: "ECC",
  cantares: "SNG",
  cantico: "SNG",
  "canticodoscanticos": "SNG",
  ct: "SNG",
  isaias: "ISA",
  is: "ISA",
  jeremias: "JER",
  jr: "JER",
  lamentacoes: "LAM",
  lm: "LAM",
  ezequiel: "EZK",
  ez: "EZK",
  daniel: "DAN",
  dn: "DAN",
  oseias: "HOS",
  os: "HOS",
  joel: "JOL",
  jl: "JOL",
  amos: "AMO",
  am: "AMO",
  obadias: "OBA",
  ob: "OBA",
  jonas: "JON",
  jn: "JON",
  miqueias: "MIC",
  mq: "MIC",
  naum: "NAM",
  na: "NAM",
  habacuque: "HAB",
  hc: "HAB",
  sofonias: "ZEP",
  sf: "ZEP",
  ageu: "HAG",
  ag: "HAG",
  zacarias: "ZEC",
  zc: "ZEC",
  malaquias: "MAL",
  ml: "MAL",
  // Novo Testamento
  mateus: "MAT",
  mt: "MAT",
  marcos: "MRK",
  mc: "MRK",
  lucas: "LUK",
  lc: "LUK",
  joao: "JHN",
  atos: "ACT",
  at: "ACT",
  romanos: "ROM",
  rm: "ROM",
  "1corintios": "1CO",
  "1co": "1CO",
  "2corintios": "2CO",
  "2co": "2CO",
  galatas: "GAL",
  gl: "GAL",
  efesios: "EPH",
  ef: "EPH",
  filipenses: "PHP",
  fp: "PHP",
  colossenses: "COL",
  cl: "COL",
  "1tessalonicenses": "1TH",
  "1ts": "1TH",
  "2tessalonicenses": "2TH",
  "2ts": "2TH",
  "1timoteo": "1TI",
  "1tm": "1TI",
  "2timoteo": "2TI",
  "2tm": "2TI",
  tito: "TIT",
  tt: "TIT",
  filemom: "PHM",
  fm: "PHM",
  hebreus: "HEB",
  hb: "HEB",
  tiago: "JAS",
  tg: "JAS",
  "1pedro": "1PE",
  "1pe": "1PE",
  "2pedro": "2PE",
  "2pe": "2PE",
  "1joao": "1JN",
  "1jo": "1JN",
  "2joao": "2JN",
  "2jo": "2JN",
  "3joao": "3JN",
  "3jo": "3JN",
  judas: "JUD",
  jd: "JUD",
  apocalipse: "REV",
  ap: "REV",
};

/** minúsculo, sem acento, sem espaço/ponto — a mesma chave usada no mapa acima. */
function normalizar(livro: string): string {
  return livro
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.\s]/g, "");
}

/** Código USX do livro, ou `null` se o nome não bater com nada do mapa. */
export function codigoDoLivro(livro: string): string | null {
  return MAPA_LIVRO_PARA_CODIGO[normalizar(livro)] ?? null;
}

/**
 * Monta o `passage_id` que a API da YouVersion espera. `versiculoFinal`
 * (opcional) monta uma faixa dentro do MESMO capítulo (ex.: "PSA.115.16-17"
 * — sintaxe confirmada contra a API real). Cruzar capítulo numa faixa não é
 * suportado pelo contrato conhecido; quem chama valida isso antes.
 */
export function montarPassageId(
  codigoLivro: string,
  capitulo: number,
  versiculo: number,
  versiculoFinal?: number,
): string {
  const base = `${codigoLivro}.${capitulo}.${versiculo}`;
  return versiculoFinal && versiculoFinal > versiculo ? `${base}-${versiculoFinal}` : base;
}
