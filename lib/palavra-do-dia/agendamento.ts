/**
 * O relógio de parede da organização, pro cron `palavra-do-dia` saber QUANDO
 * agir e qual é o "hoje" dela — nunca o do servidor.
 *
 * Versão local, mínima, do que o produto upstream chama `cron-de-data.ts`
 * (compartilhado com o gatilho `lead.date_field_due`, que este fork ainda não
 * tem). Construída sobre `partesNoFuso` (`lib/agenda/fuso.ts`), que já é a
 * fonte de verdade de fuso deste repo — sem duplicar a leitura do relógio, só
 * o que falta em cima dela.
 */
import { partesNoFuso } from "@/lib/agenda/fuso";

/** Fuso de quem não declarou o seu — o mesmo padrão do resto do produto. */
export const FUSO_PADRAO = "America/Sao_Paulo";

/** Quantos leads uma organização rende por rodada. */
export const TETO_POR_ORGANIZACAO = 200;

/** O PostgREST monta a lista do `in` dentro da URL, e URL tem fim. */
export const TAMANHO_DO_LOTE = 100;

/** O fuso que vale para a organização: o dela, ou o padrão do produto. */
export function fusoDaOrganizacao(timezone: string | null | undefined): string {
  return timezone?.trim() || FUSO_PADRAO;
}

/** É a hora marcada no relógio da organização? */
export function eHoraDaVarredura(agora: Date, fuso: string, hora: number): boolean {
  return partesNoFuso(agora, fuso).hora === hora;
}

/** O dia do relógio de parede (`YYYY-MM-DD`) — o "hoje" que a organização vê. */
export function diaLocal(agora: Date, fuso: string): string {
  const { ano, mes, dia } = partesNoFuso(agora, fuso);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}
