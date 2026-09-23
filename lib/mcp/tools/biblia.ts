/**
 * Busca de versículo sob demanda — a mesma API da YouVersion que já alimenta
 * a "Palavra do Dia" (`lib/palavra-do-dia/youversion.ts`), agora chamável pelo
 * agente quando ALGUÉM pergunta "o que diz Salmos 115:16" no meio da conversa.
 *
 * Sem esta tool, o agente só tinha duas saídas ruins diante de uma referência
 * específica: inventar o texto (proibido pelo próprio prompt do tenant) ou
 * dizer sempre "vou confirmar com a equipe" — mesmo pra um versículo
 * conhecido, público, que uma chamada de API resolve na hora.
 */
import { z } from "zod";

import { env } from "@/lib/env";
import {
  buscarPassagemPorId,
  YouVersionConfigError,
  YouVersionPassageNotFoundError,
  YouVersionRequestError,
} from "@/lib/palavra-do-dia/youversion";
import { codigoDoLivro, montarPassageId } from "@/lib/biblia/livros";
import type { McpToolDefinition } from "../types";

const inputShape = {
  livro: z
    .string()
    .trim()
    .min(1)
    .describe('Nome do livro em português, como a pessoa falou (ex.: "Salmos", "1 Coríntios", "João").'),
  capitulo: z.number().int().min(1).describe("Número do capítulo."),
  versiculo: z.number().int().min(1).describe("Número do versículo (o primeiro, se for uma faixa)."),
  versiculo_final: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Último versículo da faixa, quando a pessoa pediu mais de um (ex.: \"115:16-17\"). Só dentro do MESMO capítulo."),
};

export const crmSearchBibleVerse: McpToolDefinition<typeof inputShape> = {
  name: "crm_search_bible_verse",
  description:
    "Busca o TEXTO REAL de um versículo (ou faixa curta de versículos do mesmo capítulo) na Bíblia, " +
    "na tradução configurada da organização. Use sempre que alguém perguntar o que diz uma referência " +
    "bíblica específica (livro + capítulo + versículo) — NUNCA cite de memória. Não serve para " +
    "perguntas de doutrina/interpretação (use crm_search_knowledge para isso) nem para o versículo " +
    "do dia (isso é automático). Se a referência não existir, devolve `encontrado: false` — diga à " +
    "pessoa que não achou essa referência e confirme livro/capítulo/versículo com ela.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input) => {
    const codigo = codigoDoLivro(input.livro);
    if (!codigo) {
      return {
        encontrado: false,
        motivo: "livro_nao_reconhecido",
        mensagem: `Não reconheci o livro "${input.livro}". Confirme o nome com a pessoa.`,
      };
    }
    if (input.versiculo_final !== undefined && input.versiculo_final < input.versiculo) {
      return {
        encontrado: false,
        motivo: "faixa_invalida",
        mensagem: "versiculo_final não pode ser menor que versiculo.",
      };
    }

    const passageId = montarPassageId(codigo, input.capitulo, input.versiculo, input.versiculo_final);

    try {
      const passagem = await buscarPassagemPorId(env, passageId);
      return {
        encontrado: true,
        referencia: passagem.referencia,
        texto: passagem.texto,
        versao: passagem.versao,
      };
    } catch (err) {
      if (err instanceof YouVersionPassageNotFoundError) {
        return {
          encontrado: false,
          motivo: "referencia_nao_encontrada",
          mensagem: `Não encontrei ${input.livro} ${input.capitulo}:${input.versiculo}${
            input.versiculo_final ? `-${input.versiculo_final}` : ""
          }. Confirme a referência com a pessoa.`,
        };
      }
      if (err instanceof YouVersionConfigError) {
        return {
          encontrado: false,
          motivo: "sem_chave_configurada",
          mensagem: "Esta instalação não tem a chave da YouVersion configurada — avise a equipe.",
        };
      }
      if (err instanceof YouVersionRequestError) {
        return {
          encontrado: false,
          motivo: "erro_no_provedor",
          mensagem: "Não consegui consultar a Bíblia agora. Tente de novo em instantes.",
        };
      }
      throw err;
    }
  },
};
