-- Handoff automático por pessoa/tipo de pedido (não só o balde genérico
-- "Chamar Humano"). Ver lib/leads/handoff-stage-move.ts.
--
-- Hoje, quando o cliente pede humano (ou o próprio agente promete "vou
-- encaminhar com o Fernando"), o card só pode ir para UMA etapa por pipeline
-- (slug = 'chamar-humano'). Um tenant que já nomeia a pessoa/setor no próprio
-- funil (ex.: "Repassado para o Fernando") não tinha como o sistema decidir
-- automaticamente por aquele destino específico — o card sempre caía no
-- balde genérico e um humano precisava mover na mão de novo.
--
-- `handoff_keywords` é o mesmo padrão de `ai_agent_versions.handoff_keywords`
-- (substring case-insensitive), só que por ETAPA: quando o texto que disparou
-- o handoff contém uma destas palavras, o card vai direto para ESTA etapa em
-- vez do destino genérico. Opt-in e aditivo — etapa sem nenhuma palavra
-- configurada (a imensa maioria) não muda de comportamento nenhum.
alter table public.crm_stages
  add column if not exists handoff_keywords text[] not null default '{}';

comment on column public.crm_stages.handoff_keywords is
  'Palavras-chave (substring, case-insensitive) que, ao aparecer no sinal que disparou um handoff, roteiam o lead DIRETO para esta etapa em vez do destino genérico (slug=chamar-humano). Vazio (padrão) = etapa não participa do roteamento por pessoa. Resolvido por lib/leads/handoff-stage-move.ts:resolveEtapaDeHandoff.';
