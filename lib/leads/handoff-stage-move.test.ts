import { describe, expect, it } from 'vitest';

import { resolveEtapaDeHandoff, type EstagioCandidatoDeHandoff } from './handoff-stage-move';

const generica: EstagioCandidatoDeHandoff = {
  id: 'chamar-humano-id',
  name: 'Chamar Humano',
  slug: 'chamar-humano',
  handoff_keywords: [],
  is_archived: false,
};

const doFernando: EstagioCandidatoDeHandoff = {
  id: 'fernando-id',
  name: 'Repassado para o Fernando',
  slug: 'repassado-fernando',
  handoff_keywords: ['fernando', 'gerente'],
  is_archived: false,
};

describe('resolveEtapaDeHandoff', () => {
  it('roteia para a etapa que reivindica a palavra do sinal, não para a genérica', () => {
    const r = resolveEtapaDeHandoff([generica, doFernando], 'quero falar com o Fernando');
    expect(r?.id).toBe('fernando-id');
  });

  it('casa case-insensitive e por substring', () => {
    const r = resolveEtapaDeHandoff([generica, doFernando], 'PODE CHAMAR O GERENTE?');
    expect(r?.id).toBe('fernando-id');
  });

  it('cai na etapa genérica quando nenhuma etapa reivindica palavra do sinal', () => {
    const r = resolveEtapaDeHandoff([generica, doFernando], 'quero falar com um atendente');
    expect(r?.id).toBe('chamar-humano-id');
  });

  it('sem sinal, cai direto na genérica (comportamento de sempre)', () => {
    const r = resolveEtapaDeHandoff([generica, doFernando], undefined);
    expect(r?.id).toBe('chamar-humano-id');
  });

  it('sem etapa genérica e sem etapa por pessoa, não tem destino nenhum', () => {
    const r = resolveEtapaDeHandoff([doFernando], 'oi, tudo bem?');
    expect(r).toBeNull();
  });

  it('ignora etapa arquivada mesmo que reivindique a palavra', () => {
    const arquivada: EstagioCandidatoDeHandoff = { ...doFernando, is_archived: true };
    const r = resolveEtapaDeHandoff([generica, arquivada], 'falar com fernando');
    expect(r?.id).toBe('chamar-humano-id');
  });

  it('ignora palavra vazia/em branco na lista da etapa', () => {
    const comVazia: EstagioCandidatoDeHandoff = { ...doFernando, handoff_keywords: ['', '  ', 'fernando'] };
    const r = resolveEtapaDeHandoff([generica, comVazia], 'oi');
    // "oi" não contém "fernando" — não deve casar com a entrada vazia e mover à toa.
    expect(r?.id).toBe('chamar-humano-id');
  });
});
