/**
 * Capacidade de BÍBLIA — busca de versículo sob demanda, para agentes de
 * nicho religioso (ex.: Igreja Digital). Não é a "Palavra do Dia" (isso é
 * automático, via cron); é a pessoa perguntando uma referência específica no
 * meio da conversa.
 */
import { declararTools } from "./tipos";

export const TOOLS_BIBLIA = declararTools([
  {
    name: "crm_search_bible_verse",
    category: "read",
    rotulo: "Buscar um versículo da Bíblia",
    explicacao:
      "Busca o texto real de uma referência bíblica (livro, capítulo e versículo) na tradução " +
      "configurada, em vez de o assistente citar de memória e arriscar errar.",
    oQueToca: "Base de conhecimento",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
