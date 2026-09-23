-- 0255 · Unidades/células físicas da organização, para localizar a mais perto de um CEP.
--
-- ─── Por que esta tabela existe ─────────────────────────────────────────────
-- A Igreja Digital quer indicar ao membro qual célula/unidade fica mais perto
-- do endereço dele. Não havia NENHUM conceito de "local físico da organização"
-- no schema (o `location_kind` de `calendar_event_types` é sobre COMO o
-- atendimento acontece — presencial/telefone/vídeo — não sobre ONDE). Isto é
-- genérico o bastante para qualquer organização com múltiplas unidades/filiais,
-- não só igrejas.
--
-- ─── lat/lng cacheados, não recalculados a cada busca ───────────────────────
-- O geocoding do CEP de uma unidade (via API pública, gratuita) roda UMA VEZ,
-- ao cadastrar/editar a unidade — não a cada vez que alguém pergunta a
-- distância. As APIs gratuitas de geocoding têm limite de taxa (ex.: Nominatim,
-- ~1 req/s) e o conjunto de unidades de uma organização muda raríssimo; recalcular
-- a cada pergunta seria caro e lento sem ganhar precisão nenhuma.
-- `geocoded_at` null = ainda não geocodificada (cadastro sem lat/lng ainda) ou
-- o CEP falhou a resolver; a ferramenta que lê esta tabela decide o que fazer
-- com uma unidade sem coordenada (hoje: ignora no cálculo de distância).
--
-- ─── RLS ligada, zero policies (server-only, como instagram_apps/0239) ──────
-- Não existe tela ainda que leia isto pelo browser — só o MCP tool (service
-- role) e o script de administração usam esta tabela por enquanto. Dar uma
-- policy de leitura por tenant agora seria abrir uma porta sem fechadura
-- (nenhuma tela valida o que entra); quando uma tela de "Unidades" existir,
-- uma policy `tenant_isolation` (o padrão de `crm_pipelines`) entra numa
-- migration própria, junto com a tela.

create table if not exists public.crm_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name text not null,
  cep text not null,
  address text,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_locations_cep_format check (cep ~ '^[0-9]{8}$')
);

create index if not exists idx_crm_locations_org_active
  on public.crm_locations (organization_id)
  where is_active;

alter table public.crm_locations enable row level security;
revoke all on public.crm_locations from anon, authenticated;
grant select, insert, update, delete on public.crm_locations to service_role;

drop trigger if exists trg_crm_locations_updated_at on public.crm_locations;
create trigger trg_crm_locations_updated_at
  before update on public.crm_locations
  for each row execute function public.fn_set_updated_at();

comment on table public.crm_locations is
  'Unidades/filiais físicas da organização (nome + CEP + coordenadas cacheadas), usadas para localizar a mais próxima de um CEP informado pelo lead. Server-only: RLS ligada sem policies, só service_role.';
comment on column public.crm_locations.geocoded_at is
  'Quando lat/lng foi resolvido a partir do CEP (API pública de geocoding). Null = ainda não geocodificada ou o CEP falhou a resolver — o cálculo de distância ignora a linha até isto ser preenchido.';
