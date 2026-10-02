// app/api/v1/messages/[id]/media/route.ts
/**
 * GET /api/v1/messages/[id]/media — acesso autenticado à mídia da mensagem.
 * Persistida → bytes do bucket whatsapp-media servidos por esta URL estável,
 * com cache `immutable` no navegador (302 pra signed URL só se o fetch falhar).
 * Ainda não persistida (janela até o worker rodar) → proxy dos bytes do WAHA.
 * A URL desta rota é usada diretamente como src de <img>/<video>/<audio>
 * (cookie de sessão vai junto por ser same-origin; RLS decide o acesso).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_S = 3600;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: messageId } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", t("No active organization."), 403, { requestId });
  }

  // Client de sessão: RLS garante que a mensagem pertence a uma org do usuário.
  // Filtro explícito de organization_id por doutrina (defense-in-depth).
  const { data: msg, error } = await supabase
    .from("messages")
    .select("id, media_url, media_mime, media_storage_path, channel_session_id")
    .eq("id", messageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) {
    return fail("internal_error", t("Erro ao buscar mensagem."), 500, { requestId });
  }
  if (!msg || (!msg.media_storage_path && !msg.media_url)) {
    return fail("not_found", t("Mensagem sem mídia."), 404, { requestId });
  }

  if (msg.media_storage_path) {
    const admin = createAdminClient();
    const { data: signed, error: signErr } = await admin.storage
      .from("whatsapp-media")
      .createSignedUrl(msg.media_storage_path, SIGNED_URL_TTL_S);
    if (!signErr && signed?.signedUrl) {
      // ── Por que proxy, e não mais o 302 ──────────────────────────────────
      //
      // O 302 apontava para uma signed URL com token NOVO a cada pedido. URL
      // nova = cache do navegador sempre vazio: toda abertura de conversa
      // baixava de novo cada foto/áudio/PDF direto do Storage, e isso é egress
      // do Supabase. Medido em 2026-10-02: o projeto estourou a cota de egress
      // do plano com ~1,2 GB de mídia sendo rebaixada o dia inteiro.
      //
      // Servindo os bytes por ESTA URL (estável: o id da mensagem) com
      // `immutable`, cada navegador baixa cada arquivo uma vez. O arquivo de uma
      // mensagem persistida não muda — o caminho no bucket é por mensagem.
      // `private`: a autorização acima é por usuário; proxy compartilhado não
      // guarda. `Range` é repassado porque <audio>/<video> pedem pedaços (o
      // Safari não toca vídeo sem 206).
      const range = req.headers.get("range");
      const upstream = await fetch(signed.signedUrl, {
        headers: range ? { Range: range } : undefined,
      }).catch(() => null);
      if (upstream && (upstream.ok || upstream.status === 206) && upstream.body) {
        const headers = new Headers({
          "Content-Type": upstream.headers.get("content-type") ?? msg.media_mime ?? "application/octet-stream",
          "Cache-Control": "private, max-age=31536000, immutable",
          "Accept-Ranges": "bytes",
          "X-Request-Id": requestId,
        });
        for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      }
      if (upstream && upstream.status === 416) {
        return new Response(null, { status: 416, headers: { "X-Request-Id": requestId } });
      }
      // Falha ao buscar no Storage: o 302 antigo continua sendo um caminho
      // válido — o navegador tenta direto, sem cache, como antes.
      const response = NextResponse.redirect(signed.signedUrl, 302);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    if (signErr) {
      console.error("[messages.media] createSignedUrl failed", signErr.message);
    }
  }

  // ── Fallback: o worker ainda não persistiu ──────────────────────────────────
  //
  // O drain é cron de minuto a minuto, então esta janela é diária: quem abre a
  // conversa antes da persistência cai aqui. O browser não alcança o transporte
  // nem tem a credencial, por isso o proxy é server-side.
  //
  // Pelo ADAPTER, não por uma função fixa. Esta era literalmente a linha que o
  // conserto do worker removeu de lá e esqueceu aqui: com `fetchWahaMedia` em
  // duro, o path de um anexo do canal intermediado era procurado dentro do
  // contêiner do canal por QR — 404, e a tela dizia "mídia indisponível".
  if (msg.media_url) {
    try {
      const admin = createAdminClient();
      const { data: sessao } = await admin
        .from("channel_sessions")
        .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
        .eq("organization_id", activeOrg.orgId)
        .eq("id", msg.channel_session_id)
        .maybeSingle();

      const adapter = getAdapter(
        ((sessao?.provider as string) ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider,
      );
      const sessionRef = sessao ? resolveSessionRef(sessao as unknown as ChannelSessionRef) : null;
      if (!adapter.fetchInboundMedia || !sessionRef) {
        // Canal sem mídia de entrada não é defeito: é estado normal. 404 diz a
        // verdade ("não há o que servir"); 502 acusaria uma falha inexistente.
        return fail("not_found", t("Mensagem sem mídia."), 404, { requestId });
      }

      const media = await adapter.fetchInboundMedia({
        organizationId: activeOrg.orgId,
        sessionRef,
        url: msg.media_url,
        hintMime: msg.media_mime,
      });
      return new Response(new Uint8Array(media.buffer), {
        status: 200,
        headers: {
          "Content-Type": media.mime,
          "Cache-Control": "private, max-age=60",
          "X-Request-Id": requestId,
        },
      });
    } catch {
      return fail("bad_gateway", t("Mídia indisponível no momento."), 502, { requestId });
    }
  }

  return fail("not_found", t("Mensagem sem mídia."), 404, { requestId });
}
