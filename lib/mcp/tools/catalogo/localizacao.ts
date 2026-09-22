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
    pacotes: ["atender"],
  },
]);
