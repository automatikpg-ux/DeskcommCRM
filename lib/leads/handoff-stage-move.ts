import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

/**
 * Move o card do lead para a etapa do funil que o tenant marcou como destino
 * de handoff, sempre que o orquestrador (`lib/ai/handoff/orchestrator.ts`)
 * decide que um atendimento precisa de humano.
 *
 * ⚠️ OPT-IN POR PIPELINE, via `slug`, não `requires_human`. `requires_human`
 * já é usado por `checkG4Stage` no sentido INVERSO (lead JÁ está numa etapa
 * assim → dispara handoff) e mais de uma etapa pode carregar essa flag no
 * mesmo pipeline (ex.: "Repassado para o Fernando", que é atribuição a uma
 * PESSOA, não "precisa de humano agora"). `slug` é estável, único por
 * pipeline (`uniq_crm_stages_pipeline_slug`) e é exatamente o campo que este
 * schema já tem para apontar sem ambiguidade — different de `name`, que o
 * tenant pode renomear a qualquer momento.
 *
 * Pipeline SEM essa etapa (todo clone novo, por padrão) não muda de
 * comportamento nenhum: `sem_etapa_de_handoff` é resposta legítima, igual ao
 * `sem_mapeamento` de `agent-stage-sync.ts` — não inventamos etapa que o
 * tenant não criou.
 */
export const SLUG_ETAPA_HANDOFF = "chamar-humano";

export interface ResultadoDoMovimentoDeHandoff {
  moveu: boolean;
  motivo:
    | "movido"
    | "sem_etapa_de_handoff"
    | "ja_esta_la"
    | "lead_nao_encontrado"
    | "lead_fechado"
    | "conflito_humano"
    | "falha_de_escrita"
    | "indisponivel";
}

/** O que o resolvedor precisa saber de cada etapa candidata do pipeline. */
export interface EstagioCandidatoDeHandoff {
  id: string;
  name: string;
  slug: string | null;
  handoff_keywords: string[] | null;
  is_archived: boolean;
}

/**
 * Escolhe a etapa de destino de um handoff (migration 0203).
 *
 * ⚠️ POR PESSOA VENCE O GENÉRICO. Quando `sinal` (o texto que disparou o
 * handoff — a mensagem do lead, ou a promessa do agente) contém uma palavra
 * que uma etapa reivindica em `handoff_keywords`, o card vai DIRETO para ela
 * — nunca para `chamar-humano`. Isso é o que falta hoje: o tenant já nomeia a
 * pessoa no funil ("Repassado para o Fernando") e já tem a palavra na lista
 * do AGENTE (`ai_agent_versions.handoff_keywords`, que decide SE escala) —
 * mas nada decidia PARA ONDE, então tudo caía no balde genérico.
 *
 * Sem `sinal`, ou sem etapa nenhuma reivindicando as palavras do sinal, o
 * comportamento é o de sempre: cai para a etapa `slug=chamar-humano`, se
 * existir. NÃO trata ambiguidade entre duas etapas reivindicando a mesma
 * palavra — mesmo raciocínio de `resolveDestinoDoAgente` em
 * `agent-stage-sync.ts`: a recusa mora na CONFIGURAÇÃO (quem cadastra vê as
 * palavras já em uso), não no runtime.
 */
export function resolveEtapaDeHandoff(
  estagios: readonly EstagioCandidatoDeHandoff[],
  sinal: string | null | undefined,
): { id: string; name: string } | null {
  const ativas = estagios.filter((e) => !e.is_archived);

  const sinalNormalizado = (sinal ?? "").toLowerCase().trim();
  if (sinalNormalizado !== "") {
    const porPessoa = ativas.find((e) =>
      (e.handoff_keywords ?? []).some((palavra) => {
        const p = palavra.toLowerCase().trim();
        return p !== "" && sinalNormalizado.includes(p);
      }),
    );
    if (porPessoa) return { id: porPessoa.id, name: porPessoa.name };
  }

  const generica = ativas.find((e) => e.slug === SLUG_ETAPA_HANDOFF);
  return generica ? { id: generica.id, name: generica.name } : null;
}

export async function moverLeadParaEtapaDeHandoff(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    leadId: string;
    /** `HandoffReason` de `lib/ai/handoff/orchestrator.ts` — string aqui para não acoplar os dois módulos. */
    reason: string;
    /**
     * O texto que disparou o handoff (mensagem do lead, ou a promessa do
     * agente) — usado só para casar contra `handoff_keywords` das etapas
     * (ver `resolveEtapaDeHandoff`). Ausente = comportamento de sempre
     * (destino genérico `chamar-humano`).
     */
    sinal?: string | null;
  },
): Promise<ResultadoDoMovimentoDeHandoff> {
  const { data: lead, error: erroLead } = await admin
    .from("crm_leads")
    .select("id, pipeline_id, stage_id, contact_id, status")
    .eq("id", input.leadId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (erroLead) {
    logger.warn("[handoff-stage-move] leitura do lead falhou", {
      lead_id: input.leadId,
      organization_id: input.organizationId,
      error: erroLead.message,
    });
    return { moveu: false, motivo: "indisponivel" };
  }
  if (!lead) {
    return { moveu: false, motivo: "lead_nao_encontrado" };
  }
  const leadRow = lead as {
    id: string;
    pipeline_id: string;
    stage_id: string;
    contact_id: string | null;
    status: string;
  };

  // Negócio já fechado (ganho/perdido) não volta a se mexer por causa de um
  // handoff — moveria um card que a organização já considera encerrado.
  if (leadRow.status !== "open") {
    return { moveu: false, motivo: "lead_fechado" };
  }

  // Traz TODAS as etapas ativas do pipeline (não só a genérica): o resolvedor
  // precisa ver quem reivindica palavra própria antes de cair no genérico.
  const { data: estagios, error: erroEtapa } = await admin
    .from("crm_stages")
    .select("id, name, slug, handoff_keywords, is_archived")
    .eq("pipeline_id", leadRow.pipeline_id)
    .eq("is_archived", false);
  if (erroEtapa) {
    logger.warn("[handoff-stage-move] leitura da etapa de handoff falhou", {
      lead_id: leadRow.id,
      organization_id: input.organizationId,
      error: erroEtapa.message,
    });
    return { moveu: false, motivo: "indisponivel" };
  }
  const etapaRow = resolveEtapaDeHandoff((estagios ?? []) as EstagioCandidatoDeHandoff[], input.sinal);
  if (!etapaRow) {
    return { moveu: false, motivo: "sem_etapa_de_handoff" };
  }

  if (leadRow.stage_id === etapaRow.id) {
    return { moveu: false, motivo: "ja_esta_la" };
  }

  // Nome da origem só enfeita o texto da timeline — erro descartado de
  // propósito, mesmo raciocínio de `agent-stage-sync.ts`.
  const { data: origem } = await admin
    .from("crm_stages")
    .select("name")
    .eq("id", leadRow.stage_id)
    .maybeSingle();

  const { data: atualizadas, error: erroUpdate } = await admin
    .from("crm_leads")
    .update({ stage_id: etapaRow.id })
    .eq("id", leadRow.id)
    // Trava otimista pelo estágio de ORIGEM: se um humano moveu o card entre a
    // leitura e a escrita, a decisão dele vence.
    .eq("stage_id", leadRow.stage_id)
    .select("id");
  if (erroUpdate) {
    logger.warn("[handoff-stage-move] update de stage_id falhou", {
      lead_id: leadRow.id,
      organization_id: input.organizationId,
      error: erroUpdate.message,
    });
    return { moveu: false, motivo: "falha_de_escrita" };
  }
  if ((atualizadas ?? []).length === 0) {
    return { moveu: false, motivo: "conflito_humano" };
  }

  const atividade = await emitLeadActivity(admin, {
    organizationId: input.organizationId,
    leadId: leadRow.id,
    contactId: leadRow.contact_id,
    type: "stage_changed",
    sourceModule: "ai",
    sourceId: leadRow.id,
    actor: { type: "webhook_source", id: "handoff-orchestrator" },
    reason: stageChangeReason((origem as { name: string } | null)?.name ?? null, etapaRow.name),
    payload: { motivo_do_handoff: input.reason, de: leadRow.stage_id, para: etapaRow.id },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(admin, {
      organizationId: input.organizationId,
      leadId: leadRow.id,
      tipo: "stage_changed",
      origem: "lib/leads/handoff-stage-move",
      erro: atividade.error,
    });
  }

  // Mesmo evento que `agent-stage-sync.ts` emite ao mover pelo agente — para
  // que regras de automação e follow-up que escutam `lead.stage_changed`
  // reajam igual, tenha o card se movido pela mão, pelo agente ou por handoff.
  const { error: erroEvento } = await admin.rpc("emit_event" as never, {
    p_event_type: "lead.stage_changed",
    p_entity_kind: "crm_lead",
    p_entity_id: leadRow.id,
    p_payload: {
      pipeline_id: leadRow.pipeline_id,
      from_stage_id: leadRow.stage_id,
      to_stage_id: etapaRow.id,
      status: leadRow.status,
    },
    p_metadata: { actor_kind: "system", source: "handoff-stage-move", motivo_do_handoff: input.reason },
    p_organization_id: input.organizationId,
  } as never);
  if (erroEvento) {
    logger.error("[handoff-stage-move] emit_event lead.stage_changed falhou", {
      lead_id: leadRow.id,
      organization_id: input.organizationId,
      error: (erroEvento as { message?: string }).message ?? String(erroEvento),
    });
  }

  return { moveu: true, motivo: "movido" };
}
