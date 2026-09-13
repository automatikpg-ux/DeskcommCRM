/**
 * A parte PURA do OAuth do Instagram: montar a URL de autorização e ler as
 * respostas de token. Sem rede aqui — isso mora em `token.ts`. Mesma divisão
 * de `lib/agenda/google/oauth.ts` (puro) x `lib/agenda/google/token.ts` (rede).
 */

export const ENDERECO_DE_AUTORIZACAO = "https://www.instagram.com/oauth/authorize";
export const ENDERECO_DE_TOKEN_CURTO = "https://api.instagram.com/oauth/access_token";
export const ENDERECO_DE_TOKEN_LONGO = "https://graph.instagram.com/access_token";
export const ENDERECO_DE_PERFIL = "https://graph.instagram.com/v21.0/me";

/**
 * `instagram_business_basic`: ler id/username/tipo de conta.
 * `instagram_business_content_publish`: publicar feed/reels/stories.
 * Nomes atuais (a Meta descontinuou `instagram_content_publish`/
 * `instagram_basic` da via Facebook Login para quem usa Instagram Login).
 */
export const ESCOPOS_DE_PUBLICACAO = "instagram_business_basic,instagram_business_content_publish";

export function montarUrlDeAutorizacao(args: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(ENDERECO_DE_AUTORIZACAO);
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ESCOPOS_DE_PUBLICACAO);
  url.searchParams.set("state", args.state);
  // Força a tela de login DO INSTAGRAM, sem a opção "continuar com Facebook" —
  // o lead não precisa ter Página do Facebook para ver a tela de consentimento
  // (a conta ainda precisa ser Business/Creator, isso a Meta exige de outro
  // jeito, na hora de publicar).
  url.searchParams.set("enable_fb_login", "0");
  return url.toString();
}

export type LeituraDeTokenCurto =
  | { ok: true; accessToken: string; igUserId: string }
  | { ok: false; motivo: "resposta_invalida" | "sem_token"; detalhe: string };

/** A Meta embrulha a resposta do token curto num array `data: [...]`. */
export function lerRespostaDeTokenCurto(bruto: unknown): LeituraDeTokenCurto {
  const registro = bruto as { data?: unknown[]; error_message?: string } | null;
  if (registro?.error_message) {
    return { ok: false, motivo: "sem_token", detalhe: registro.error_message };
  }
  const item = Array.isArray(registro?.data) ? (registro.data[0] as Record<string, unknown>) : null;
  const accessToken = item?.access_token;
  const igUserId = item?.user_id;
  if (typeof accessToken !== "string" || !accessToken) {
    return { ok: false, motivo: "resposta_invalida", detalhe: "sem access_token na resposta" };
  }
  return { ok: true, accessToken, igUserId: String(igUserId ?? "") };
}

export type LeituraDeTokenLongo =
  | { ok: true; accessToken: string; expiraEm: string }
  | { ok: false; motivo: "resposta_invalida" | "sem_token"; detalhe: string };

export function lerRespostaDeTokenLongo(bruto: unknown, opcoes: { agora: Date }): LeituraDeTokenLongo {
  const registro = bruto as { access_token?: string; expires_in?: number; error_message?: string } | null;
  if (registro?.error_message) {
    return { ok: false, motivo: "sem_token", detalhe: registro.error_message };
  }
  if (typeof registro?.access_token !== "string" || !registro.access_token) {
    return { ok: false, motivo: "resposta_invalida", detalhe: "sem access_token na resposta" };
  }
  const segundos = typeof registro.expires_in === "number" ? registro.expires_in : 60 * 24 * 60 * 60; // ~60 dias, o padrão documentado
  const expiraEm = new Date(opcoes.agora.getTime() + segundos * 1000).toISOString();
  return { ok: true, accessToken: registro.access_token, expiraEm };
}

export type LeituraDePerfil =
  | { ok: true; id: string; username: string | null; accountType: string | null }
  | { ok: false; motivo: "resposta_invalida" | "erro_da_meta"; detalhe: string };

export function lerRespostaDePerfil(bruto: unknown): LeituraDePerfil {
  const registro = bruto as
    | { id?: string; username?: string; account_type?: string; error?: { message?: string } }
    | null;
  if (registro?.error) {
    return { ok: false, motivo: "erro_da_meta", detalhe: registro.error.message ?? "erro sem mensagem" };
  }
  if (typeof registro?.id !== "string" || !registro.id) {
    return { ok: false, motivo: "resposta_invalida", detalhe: "sem id na resposta" };
  }
  return {
    ok: true,
    id: registro.id,
    username: typeof registro.username === "string" ? registro.username : null,
    accountType: typeof registro.account_type === "string" ? registro.account_type : null,
  };
}
