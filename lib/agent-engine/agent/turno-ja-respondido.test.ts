import { expect, it, vi } from 'vitest';
import type pg from 'pg';

import { anotarUltimaInboundVista, ultimaInboundJaRespondida } from './turno-ja-respondido';

const alvo = { organizationId: 'org1', contactId: 'ct1', conversationId: 'conv1', jobId: 'job1' };

function poolFalso(linhas: Record<string, unknown>[], chamadas: unknown[][] = []): pg.Pool {
  const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    chamadas.push([sql, params]);
    return { rows: linhas };
  });
  return { query } as unknown as pg.Pool;
}

it('outro turno que viu a última mensagem já respondeu → pula', async () => {
  expect(await ultimaInboundJaRespondida(poolFalso([{ respondida: true }]), alvo)).toBe(true);
});

it('ninguém que viu a última mensagem respondeu → responde', async () => {
  expect(await ultimaInboundJaRespondida(poolFalso([{ respondida: false }]), alvo)).toBe(false);
});

it('sem linha (falha estranha do driver) → não pula: na dúvida, responde', async () => {
  expect(await ultimaInboundJaRespondida(poolFalso([]), alvo)).toBe(false);
});

it('a régua é "quem VIU a mensagem respondeu", não "tem outbound depois dela"', async () => {
  const chamadas: unknown[][] = [];
  await ultimaInboundJaRespondida(poolFalso([{ respondida: false }], chamadas), alvo);
  const [sql, params] = chamadas[0] as [string, unknown[]];
  expect(params).toEqual(['org1', 'conv1', 'ct1', 'job1']);
  expect(sql).toContain("(j.payload->>'ultima_inbound_vista_em')::timestamptz >= u.em");
  expect(sql).toContain("s.status in ('accepted', 'queued')");
  expect(sql).toContain("j.kind = 'inbound_turn'");
  expect(sql).toContain('s.job_id <> $4');
});

it('a anotação grava no próprio job a inbound mais nova, sem pisar no resto do payload', async () => {
  const chamadas: unknown[][] = [];
  await anotarUltimaInboundVista(poolFalso([], chamadas), alvo);
  const [sql, params] = chamadas[0] as [string, unknown[]];
  expect(params).toEqual(['org1', 'conv1', 'job1']);
  expect(sql).toContain('payload = payload || jsonb_build_object');
  expect(sql).toContain("'ultima_inbound_vista_em'");
});
