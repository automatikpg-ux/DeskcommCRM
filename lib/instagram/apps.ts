/**
 * O Meta App da organização — App ID + Secret decifrado.
 *
 * Um por organização (`instagram_apps`, migration 0239, unique em
 * `organization_id`). Mesma cifra do resto do repo (`fn_encrypt_oauth`/
 * `fn_decrypt_oauth`, ver `lib/webhooks/secrets.ts`) — nunca um terceiro
 * caminho.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface InstagramApp {
  appId: string;
  appSecret: string;
}

/**
 * `null` quando a organização não cadastrou um App ainda, ou quando a
 * decifra falhou (chave mestra ausente na instalação) — o chamador trata os
 * dois casos como "Instagram não configurado", nunca como erro 500: uma
 * rota pública alcançável por um lead não pode vazar stack de servidor.
 */
export async function instagramAppDaOrganizacao(
  admin: SupabaseClient,
  organizationId: string,
): Promise<InstagramApp | null> {
  const { data, error } = await admin
    .from("instagram_apps")
    .select("app_id, app_secret_encrypted")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data || !data.app_secret_encrypted) return null;

  const appSecret = await decryptWebhookSecret(
    admin,
    data.app_secret_encrypted as unknown as string,
  );
  if (!appSecret) return null;

  return { appId: data.app_id as string, appSecret };
}
