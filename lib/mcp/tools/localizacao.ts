/**
 * Localização — achar a unidade/célula da organização mais perto de um CEP.
 *
 * ⚠️ FACHADA FINA: geocoding e distância vivem em `lib/localizacao/geocoding.ts`
 * (mesma função usada pelo cadastro em `lib/localizacao/unidades.ts`).
 *
 * ⚠️ RECUSA DE NEGÓCIO NÃO É EXCEÇÃO — CEP que não geocodifica e organização
 * sem unidade cadastrada são RESPOSTAS (`encontrado: false` com o motivo), não
 * erros: o modelo precisa aprender e contar a verdade, não tentar de novo igual
 * nem inventar proximidade.
 */
import { z } from "zod";

import { distanciaKm, geocodificarCep } from "@/lib/localizacao/geocoding";
import type { McpToolDefinition } from "../types";

const inputShape = {
  cep: z.string().min(8).max(9),
  limite: z.number().int().min(1).max(5).optional(),
};

interface UnidadeGeocodificada {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export const crmFindNearestLocation: McpToolDefinition<typeof inputShape> = {
  name: "crm_find_nearest_location",
  description:
    "Recebe um CEP e devolve as unidades/células da organização mais próximas dele, ordenadas por " +
    "distância em km. Use quando a pessoa quiser saber qual unidade fica mais perto dela e informar o " +
    "CEP. Se o CEP não resolver, ou não houver nenhuma unidade cadastrada com coordenada, a resposta diz " +
    "isso explicitamente — nunca invente proximidade nem nome de unidade.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const alvo = await geocodificarCep(input.cep);
    if (!alvo) {
      return {
        encontrado: false as const,
        motivo: "cep_nao_resolvido",
        mensagem: `Não consegui localizar o CEP "${input.cep}" — confirme se está certo (8 dígitos).`,
      };
    }

    const { data, error } = await ctx.supabase
      .from("crm_locations")
      .select("name, address, lat, lng")
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", true)
      .not("lat", "is", null)
      .not("lng", "is", null);
    if (error) throw new Error(error.message);

    const unidades = (data ?? []) as UnidadeGeocodificada[];
    if (unidades.length === 0) {
      return {
        encontrado: false as const,
        motivo: "sem_unidade_cadastrada",
        mensagem: "Ainda não há nenhuma unidade/célula cadastrada com localização — avise a equipe.",
      };
    }

    const limite = input.limite ?? 3;
    const ordenadas = unidades
      .map((u) => ({
        nome: u.name,
        endereco: u.address,
        distancia_km: Math.round(distanciaKm(alvo, u) * 10) / 10,
      }))
      .sort((a, b) => a.distancia_km - b.distancia_km)
      .slice(0, limite);

    return { encontrado: true as const, cep_resolvido: alvo.enderecoResolvido, unidades: ordenadas };
  },
};
