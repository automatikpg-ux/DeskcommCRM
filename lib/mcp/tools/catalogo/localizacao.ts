/**
 * Capacidade de LOCALIZAÇÃO — achar a unidade/célula mais perto de um CEP.
 * Nasceu para a Igreja Digital (célula perto do membro), mas serve qualquer
 * organização com mais de uma unidade física (loja, clínica, filial).
 */
import { declararTools } from "./tipos";

export const TOOLS_LOCALIZACAO = declararTools([
  {
    name: "crm_find_nearest_location",
    category: "read",
    rotulo: "Achar a unidade mais perto de um CEP",
    explicacao:
      "Quando o cliente informa o CEP dele, o agente calcula a distância até cada unidade cadastrada " +
      "e responde qual fica mais perto — sem inventar proximidade quando não há unidade cadastrada.",
    oQueToca: "Unidades da organização",
    risco: "seguro",
    // FORA de "atender" pelo mesmo motivo de `crm_search_bible_verse`
    // (`catalogo/biblia.ts`): "atender" já encosta no teto de capacidades por
    // agente, e uma vaga a mais ali faz o pacote inteiro ser recusado. Fica em
    // "evoluir" — consultar o que a organização já cadastrou — e continua
    // alcançável em qualquer jornada pelo modo avançado.
    pacotes: ["evoluir"],
  },
]);
