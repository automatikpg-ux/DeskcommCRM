/**
 * Cadastro de unidades/células (`crm_locations`) — hoje só por script
 * administrativo (`lib/ai/agents/publish.ts` documenta o mesmo padrão: rodar
 * no container `deskcomm-devtools` com `tsx --env-file=.env`), porque ainda
 * não existe tela para isto. Quando existir, a tela chama esta mesma função —
 * a regra fica aqui, não duplicada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { geocodificarCep, normalizarCep } from "./geocoding";

export interface CadastrarUnidadeInput {
  organizationId: string;
  name: string;
  cep: string;
  /** Rua + número (ex.: "Rua Luiz Amaro Costa, 528") — melhora a precisão da geocodificação além do que o CEP sozinho dá. */
  logradouroCompleto?: string;
}

export interface UnidadeCadastrada {
  id: string;
  name: string;
  cep: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Geocodifica o CEP e grava a unidade. Nunca lança por falha de geocoding —
 * uma unidade sem coordenada é gravada mesmo assim (`geocoded_at: null`) e
 * `crm_find_nearest_location` a ignora no cálculo até alguém corrigir o CEP e
 * rodar de novo.
 */
export async function cadastrarUnidade(
  supabase: SupabaseClient,
  input: CadastrarUnidadeInput,
): Promise<UnidadeCadastrada> {
  const cep = normalizarCep(input.cep);
  if (!cep) throw new Error(`CEP inválido: "${input.cep}" — precisa ter 8 dígitos.`);

  const geo = await geocodificarCep(cep, input.logradouroCompleto);

  const { data, error } = await supabase
    .from("crm_locations")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      cep,
      address: geo?.enderecoResolvido ?? null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geocoded_at: geo ? new Date().toISOString() : null,
    })
    .select("id, name, cep, address, lat, lng")
    .single();
  if (error) throw new Error(error.message);
  return data as UnidadeCadastrada;
}
