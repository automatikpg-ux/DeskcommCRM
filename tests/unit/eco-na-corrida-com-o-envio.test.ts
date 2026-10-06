/**
 * O ECO QUE CHEGA NO MEIO DO ENVIO não pode pausar a IA nem duplicar a mensagem.
 *
 * Caso real (06/10/2026, campanha da Rodaê): a campanha gravou a mensagem sem
 * id; o eco do WAHA chegou 14 s depois e a ingestão levou 4 s. No meio, o envio
 * confirmou (gravou o id e virou `sent`). As duas guardas da ingestão erraram:
 *   - `jaRegistrada` leu ANTES — a linha ainda não tinha id;
 *   - `ehEcoDeEnvioNosso` leu DEPOIS — a linha já era `sent`, fora de "em voo".
 * Resultado: a IA pausada por 1 h na conversa e a mensagem duas vezes na tela.
 *
 * O dublê encena a corrida: o envio confirma no instante em que o eco é
 * inserido — exatamente a janela entre as duas leituras.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent, type WahaEnvelope, type WahaPayload } from "@/lib/waha/ingest";

interface Linha {
  id: string;
  organization_id: string;
  conversation_id?: string;
  external_id: string | null;
  direction?: string;
  status?: string;
  body?: string | null;
  sent_via?: string;
  [k: string]: unknown;
}

const BARE = "3EB06FABDB312F95A4EB7B";
const TEXTO = "Olá, Luciano! Somos da RODAÊ bikes elétricas. Teria interesse?\n1. Sim\n2. Não";

function banco(opcoes: { envioConfirmaNoInsertDoEco: boolean }) {
  const messages: Linha[] = [
    {
      id: "envio-campanha",
      organization_id: "org-1",
      conversation_id: "conversa-1",
      external_id: null,
      direction: "outbound",
      status: "queued",
      sent_via: "automation",
      body: TEXTO,
      type: "chat",
    },
  ];
  const conversa: Record<string, unknown> = { id: "conversa-1", bot_silenced_until: null };

  const casa = (m: Linha, filtros: Array<[string, unknown, "eq" | "in" | "neq" | "is"]>) =>
    filtros.every(([c, v, op]) => {
      if (op === "in") return (v as unknown[]).includes(m[c]);
      if (op === "neq") return m[c] !== v;
      return m[c] === v;
    });

  const consulta = (acao: "select" | "delete") => {
    const filtros: Array<[string, unknown, "eq" | "in" | "neq" | "is"]> = [];
    const q: Record<string, unknown> = {
      eq(c: string, v: unknown) {
        filtros.push([c, v, "eq"]);
        return q;
      },
      in(c: string, v: unknown[]) {
        filtros.push([c, v, "in"]);
        return q;
      },
      neq(c: string, v: unknown) {
        filtros.push([c, v, "neq"]);
        return q;
      },
      is(c: string, v: unknown) {
        filtros.push([c, v, "is"]);
        return q;
      },
      gte: () => q,
      order: () => q,
      limit: () => q,
      async maybeSingle() {
        const achou = messages.find((m) => casa(m, filtros));
        return { data: achou ? { id: achou.id } : null, error: null };
      },
      then(ok: (v: unknown) => unknown) {
        if (acao === "delete") {
          for (let i = messages.length - 1; i >= 0; i--) if (casa(messages[i], filtros)) messages.splice(i, 1);
          return Promise.resolve(ok({ error: null }));
        }
        return Promise.resolve(ok({ data: messages.filter((m) => casa(m, filtros)), error: null }));
      },
    };
    return q;
  };

  const tabela = (nome: string) => ({
    select: () =>
      nome === "conversations"
        ? { eq() { return this; }, async maybeSingle() { return { data: { bot_silenced_until: conversa.bot_silenced_until }, error: null }; } }
        : consulta("select"),
    delete: () => consulta("delete"),
    insert: (linha: Record<string, unknown>) => ({
      select: () => ({
        async maybeSingle() {
          if (nome !== "messages") return { data: { id: "x" }, error: null };
          // ⭐ A CORRIDA: o envio confirma exatamente agora.
          if (opcoes.envioConfirmaNoInsertDoEco) {
            Object.assign(messages[0], { external_id: BARE, status: "sent" });
          }
          const nova = { id: `eco-${messages.length + 1}`, ...linha } as Linha;
          messages.push(nova);
          return { data: { id: nova.id }, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => {
      if (nome === "conversations") Object.assign(conversa, patch);
      const enc: Record<string, unknown> = { error: null };
      enc.eq = () => enc;
      enc.in = () => enc;
      return enc;
    },
  });

  const admin = {
    from: (nome: string) => tabela(nome),
    rpc: async (fn: string) => {
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, messages, conversa };
}

const SESSION = { id: "sessao-1", organization_id: "org-1" };
const envelope = (p: WahaPayload): WahaEnvelope => ({ event: "message.any", session: "default", payload: p });

/** O eco real: pelo `@c.us`, enquanto o envio foi pelo `@lid`. */
const eco = (body: string): WahaPayload => ({
  id: `true_5513996919846@c.us_${BARE}`,
  from: "5513996919846@c.us",
  fromMe: true,
  body,
  timestamp: 1_760_000_000,
});

describe("eco que chega no meio do envio", () => {
  it("⭐ envio confirma entre as duas guardas: a IA NÃO é pausada e a duplicata sai", async () => {
    const { admin, conversa, messages } = banco({ envioConfirmaNoInsertDoEco: true });

    await dispatchWahaEvent(admin as never, SESSION as never, envelope(eco(TEXTO)), "req-1");

    expect(conversa.bot_silenced_until, "a IA foi pausada por ter falado — o caso do Luciano").toBeNull();
    expect(
      messages.map((m) => m.id),
      "a mensagem da campanha ficou duas vezes na conversa",
    ).toEqual(["envio-campanha"]);
  });

  it("CONTROLE: digitação real no celular (texto diferente, nenhum id nosso) AINDA pausa", async () => {
    const { admin, conversa, messages } = banco({ envioConfirmaNoInsertDoEco: false });
    const humano: WahaPayload = { ...eco("oi, é o Cristiano respondendo do celular"), id: "true_5513996919846@c.us_AAAABBBBCCCCDDDDEEEE" };

    await dispatchWahaEvent(admin as never, SESSION as never, envelope(humano), "req-2");

    expect(conversa.bot_silenced_until, "o atendente respondeu pelo celular e a IA continuou solta").not.toBeNull();
    expect(messages).toHaveLength(2);
  });

  it("CONTROLE: id NOSSO já gravado antes do eco — sai pelo dedup de sempre, sem inserir", async () => {
    const { admin, conversa, messages } = banco({ envioConfirmaNoInsertDoEco: false });
    Object.assign(messages[0], { external_id: BARE, status: "sent" });

    await dispatchWahaEvent(admin as never, SESSION as never, envelope(eco(TEXTO)), "req-3");

    expect(conversa.bot_silenced_until).toBeNull();
    expect(messages).toHaveLength(1);
  });
});
