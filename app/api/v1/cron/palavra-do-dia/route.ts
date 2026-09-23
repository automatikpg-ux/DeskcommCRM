/**
 * A PALAVRA DO DIA — a varredura que transforma o versículo do dia em
 * acontecimento por membro (issue: Igreja Digital / easymarketing).
 *
 * Mesmo desenho dos crons de relógio deste produto (varre de hora em hora, só
 * age na organização cujo relógio de parede marca a hora certa): busca o
 * conteúdo, emite UM evento por negócio (`palavra_do_dia.pronta` no
 * `event_log`) e quem manda a mensagem de verdade é a automation_rule que a
 * organização configurar com a ação `send_whatsapp_message` já existente —
 * throttle anti-banimento, janela de canal, limite diário e guardas de
 * contato (bloqueado/consentimento) são dela, não deste cron. A leitura do
 * relógio local vive em `lib/palavra-do-dia/agendamento.ts` — versão mínima,
 * só para este cron, do que o upstream compartilha entre vários crons de data.
 *
 * ═══ POR QUE UM EVENTO, E NÃO UM ENVIO DAQUI ═══
 *
 * Mandar direto daqui duplicaria throttle, janela de canal e guarda de
 * contato — que já vivem em `lib/automation/actions/send-whatsapp.ts` — e o
 * primeiro conserto de qualquer um dos dois divergiria do outro.
 *
 * ═══ SÓ AS ORGANIZAÇÕES QUE PEDIRAM ═══
 *
 * A varredura começa pelas REGRAS (`automation_rules` com
 * `trigger_event = 'palavra_do_dia.pronta'` e `is_active = true`), não pelos
 * negócios. Instalação sem essa regra configurada não paga chamada nenhuma à
 * YouVersion.
 *
 * ═══ UMA CHAMADA À YOUVERSION POR ORGANIZAÇÃO POR DIA, NUNCA POR MEMBRO ═══
 *
 * O versículo é o MESMO para todo mundo na mesma organização no mesmo dia —
 * buscado uma vez e reaproveitado no loop de negócios.
 *
 * ═══ A HORA É LOCAL ═══
 *
 * A varredura roda de hora em hora e só age na organização cujo relógio de
 * parede marca `HORA_DA_PALAVRA_DO_DIA`.
 *
 * ═══ UMA VEZ POR NEGÓCIO, POR REGRA, POR DIA ═══
 *
 * A palavra do dia É para repetir todo dia. A trava no `event_log` inclui
 * `payload->>local_date`: o par (regra, negócio, dia) não dispara duas vezes
 * na mesma rodada nem em rodadas seguintes do mesmo dia, mas o dia seguinte é
 * livre de novo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  TAMANHO_DO_LOTE,
  TETO_POR_ORGANIZACAO,
  diaLocal,
  eHoraDaVarredura,
  fusoDaOrganizacao,
} from "@/lib/palavra-do-dia/agendamento";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarPalavraDoDia, type PalavraDoDia } from "@/lib/palavra-do-dia/youversion";

export const dynamic = "force-dynamic";

export const EVENTO_PALAVRA_DO_DIA = "palavra_do_dia.pronta";

/** A hora local em que a Palavra do Dia sai — 07h, como no desenho original do produto ("todo dia às 07h"). */
export const HORA_DA_PALAVRA_DO_DIA = 7;

interface ConfigDaRegra {
  pipeline_id: string | null;
}

/** `trigger_config` é jsonb livre; leitura defensiva — regra torta não derruba as irmãs. */
function configDaRegra(bruto: unknown): ConfigDaRegra {
  const raiz = (bruto ?? {}) as Record<string, unknown>;
  const pipelineId = typeof raiz.pipeline_id === "string" && raiz.pipeline_id.trim() ? raiz.pipeline_id : null;
  return { pipeline_id: pipelineId };
}

/** Chave de dedup: mesma regra, mesmo negócio, mesmo dia local não dispara duas vezes. */
function chaveDeDisparo(ruleId: string, leadId: string, localDate: string): string {
  return `${ruleId}:${leadId}:${localDate}`;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date();

  const { data: regras, error: erroRegras } = await admin
    .from("automation_rules")
    .select("id, organization_id, trigger_config")
    .eq("trigger_event", EVENTO_PALAVRA_DO_DIA)
    .eq("is_active", true);

  if (erroRegras) {
    logger.error("[palavra-do-dia] consulta de regras falhou", { error: erroRegras.message, requestId });
    return fail("internal_error", "Falha ao buscar regras.", 500, { requestId });
  }

  const todasAsRegras = regras ?? [];
  if (todasAsRegras.length === 0) {
    return ok({ organizacoes: 0, regras: 0, examinados: 0, emitidos: 0, pulados: {} }, { requestId });
  }

  const orgsComRegra = [...new Set(todasAsRegras.map((r) => r.organization_id as string))];
  const { data: organizacoes } = await admin
    .from("organizations")
    .select("id, timezone")
    .in("id", orgsComRegra.slice(0, TAMANHO_DO_LOTE));

  let emitidos = 0;
  let examinados = 0;
  const pulados: Record<string, number> = {};
  const pular = (motivo: string, quantos = 1) => {
    pulados[motivo] = (pulados[motivo] ?? 0) + quantos;
  };

  // Uma chamada à YouVersion por organização por rodada, reaproveitada por
  // todas as regras daquela organização (o texto do dia não muda por regra).
  const versoDoDiaPorOrg = new Map<string, PalavraDoDia | null>();

  for (const organizacao of organizacoes ?? []) {
    const org = organizacao.id as string;
    const fuso = fusoDaOrganizacao(organizacao.timezone as string | null);

    let hojeLocal: string;
    try {
      if (!eHoraDaVarredura(agora, fuso, HORA_DA_PALAVRA_DO_DIA)) continue;
      hojeLocal = diaLocal(agora, fuso);
    } catch {
      pular("fuso_invalido");
      continue;
    }

    if (!versoDoDiaPorOrg.has(org)) {
      try {
        versoDoDiaPorOrg.set(org, await buscarPalavraDoDia(env, hojeLocal));
      } catch (err) {
        logger.error("[palavra-do-dia] busca na YouVersion falhou", {
          organization_id: org,
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
        versoDoDiaPorOrg.set(org, null);
      }
    }
    const verso = versoDoDiaPorOrg.get(org);
    if (!verso) {
      pular("youversion_indisponivel");
      continue;
    }

    for (const regra of todasAsRegras) {
      if (regra.organization_id !== org) continue;
      const config = configDaRegra(regra.trigger_config);

      let query = admin
        .from("crm_leads")
        .select("id")
        .eq("organization_id", org)
        .neq("status", "lost")
        .not("contact_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(TETO_POR_ORGANIZACAO);
      if (config.pipeline_id) query = query.eq("pipeline_id", config.pipeline_id);

      const { data: candidatos, error: erroLeads } = await query;
      if (erroLeads) {
        logger.error("[palavra-do-dia] consulta de negócios falhou", {
          organization_id: org,
          rule_id: regra.id,
          error: erroLeads.message,
          requestId,
        });
        pular("consulta_falhou");
        continue;
      }
      const leads = (candidatos ?? []).map((l) => l.id as string);
      if (leads.length === 0) continue;
      examinados += leads.length;

      const jaEmitidos = new Set<string>();
      for (let i = 0; i < leads.length; i += TAMANHO_DO_LOTE) {
        const lote = leads.slice(i, i + TAMANHO_DO_LOTE);
        const { data: anteriores } = await admin
          .from("event_log")
          .select("entity_id")
          .eq("organization_id", org)
          .eq("event_type", EVENTO_PALAVRA_DO_DIA)
          .eq("payload->>rule_id", regra.id)
          .eq("payload->>local_date", hojeLocal)
          .in("entity_id", lote);
        for (const anterior of anteriores ?? []) {
          jaEmitidos.add(chaveDeDisparo(regra.id, anterior.entity_id as string, hojeLocal));
        }
      }

      const novos = leads.filter((id) => !jaEmitidos.has(chaveDeDisparo(regra.id, id, hojeLocal)));
      if (novos.length < leads.length) pular("ja_emitido", leads.length - novos.length);

      for (const leadId of novos) {
        const { error: erroEvento } = await admin.rpc("emit_event" as never, {
          p_event_type: EVENTO_PALAVRA_DO_DIA,
          p_entity_kind: "crm_lead",
          p_entity_id: leadId,
          p_payload: {
            rule_id: regra.id,
            local_date: hojeLocal,
            referencia: verso.referencia,
            texto: verso.texto,
            versao: verso.versao,
          },
          p_metadata: { actor_kind: "system", source: "cron/palavra-do-dia" },
          p_organization_id: org,
        });
        if (erroEvento) {
          logger.error("[palavra-do-dia] emit_event falhou", {
            organization_id: org,
            rule_id: regra.id,
            lead_id: leadId,
            error: erroEvento.message,
            requestId,
          });
          pular("emissao_falhou");
          continue;
        }
        emitidos += 1;
      }
    }
  }

  // Rodada sem efeito não audita — CLAUDE.md §Audit log,
  // `tests/unit/cron-audita-so-quando-ha-efeito.test.ts` cobra isto por AST.
  if (emitidos > 0) {
    await audit({
      action: "palavra_do_dia.emitida",
      resourceType: "automation_rule",
      metadata: { emitidos, examinados, pulados },
      requestId,
    });
  }

  return ok(
    { organizacoes: (organizacoes ?? []).length, regras: todasAsRegras.length, examinados, emitidos, pulados },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
