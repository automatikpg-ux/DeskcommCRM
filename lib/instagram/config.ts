import { env } from "@/lib/env";

/** Precisa bater, byte a byte, com o "Valid OAuth Redirect URI" cadastrado no Meta App. */
export const CAMINHO_DO_CALLBACK = "/api/v1/instagram/oauth/callback";

export function enderecoDeRetorno(urlDaAplicacao: string = env.NEXT_PUBLIC_APP_URL): string {
  const base = urlDaAplicacao.replace(/\/+$/, "");
  return `${base}${CAMINHO_DO_CALLBACK}`;
}
