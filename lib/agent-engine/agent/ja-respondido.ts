/**
 * Turno cuja mensagem JÁ FOI RESPONDIDA — a guarda contra a resposta em dobro.
 *
 * ## O defeito (medido em produção, 2026-10-02)
 *
 * O cliente mandou "Oi" e, 22 s depois, "Como está a minha locação". O drain
 * levou ~15 s para enfileirar o primeiro turno (janela de 8 s ancorada nele) e
 * ~11 s para processar o segundo evento — quando chegou, o primeiro job já
 * estava `running`, então `decidirRajada` não achou job PENDING para a carona e
 * abriu um segundo turno. O primeiro turno leu o histórico completo e respondeu
 * às DUAS mensagens; o segundo rodou logo depois e respondeu de novo à mesma
 * pergunta. A coalescência (./../edge/crm/debounce.ts) só junta mensagens que
 * chegam enquanto o job está pendente — não tem como saber que o turno anterior
 * já cobriu a mensagem.
 *
 * ## A regra
 *
 * Se a última mensagem do AGENTE na conversa (`sent_via='ai'`, não falhada) é
 * POSTERIOR à última mensagem do CLIENTE, não há nada a responder: todo inbound
 * já foi visto por um turno que respondeu. O turno é pulado sem gasto.
 *
 * Vale só na 1ª tentativa do job: um retry (checkpoint inválido, falha depois
 * do envio) já tem a própria semântica de idempotência, e pular ali mudaria um
 * comportamento que esta correção não mediu.
 */
import type pg from 'pg';

const SQL_JA_RESPONDIDO = `select exists (
  select 1 from messages o
   where o.organization_id = $1 and o.conversation_id = $2
     and o.direction = 'outbound' and o.sent_via = 'ai'
     and o.status is distinct from 'failed'
     and o.created_at > (
       select max(i.created_at) from messages i
        where i.organization_id = $1 and i.conversation_id = $2
          and i.direction = 'inbound'
     )
) as ja_respondido`;

/** true = o agente já respondeu depois do último inbound — o turno não tem o que fazer. */
export async function inboundJaRespondido(
  pool: pg.Pool,
  alvo: { organizationId: string; conversationId: string },
): Promise<boolean> {
  const { rows } = await pool.query<{ ja_respondido: boolean }>(SQL_JA_RESPONDIDO, [
    alvo.organizationId,
    alvo.conversationId,
  ]);
  return rows[0]?.ja_respondido === true;
}
