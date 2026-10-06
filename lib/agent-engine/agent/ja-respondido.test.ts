import { expect, it, vi } from 'vitest';
import type pg from 'pg';

import { inboundJaRespondido } from './ja-respondido';

const alvo = { organizationId: 'org1', conversationId: 'conv1' };

function poolFalso(linhas: { ja_respondido: boolean }[], chamadas: unknown[][] = []): pg.Pool {
  const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    chamadas.push([sql, params]);
    return { rows: linhas };
  });
  return { query } as unknown as pg.Pool;
}

it('agente respondeu depois do último inbound → já respondido', async () => {
  expect(await inboundJaRespondido(poolFalso([{ ja_respondido: true }]), alvo)).toBe(true);
});

it('inbound mais novo que a última resposta do agente → precisa responder', async () => {
  expect(await inboundJaRespondido(poolFalso([{ ja_respondido: false }]), alvo)).toBe(false);
});

it('sem linha (falha estranha do driver) → não pula: na dúvida, responde', async () => {
  expect(await inboundJaRespondido(poolFalso([]), alvo)).toBe(false);
});

it('a consulta escopa pela org e pela conversa, e só conta resposta do agente que não falhou', async () => {
  const chamadas: unknown[][] = [];
  await inboundJaRespondido(poolFalso([{ ja_respondido: false }], chamadas), alvo);
  const [sql, params] = chamadas[0] as [string, unknown[]];
  expect(params).toEqual(['org1', 'conv1']);
  expect(sql).toContain("o.sent_via = 'ai'");
  expect(sql).toContain("o.status is distinct from 'failed'");
  expect(sql).toContain("i.direction = 'inbound'");
});
