create table if not exists public.risk_limits (
  id bigint generated always as identity primary key,
  metric_key text not null unique,
  label text not null check (btrim(label) <> ''),
  unit text not null check (unit in ('percent', 'currency', 'hhi')),
  warning_value numeric(18, 6) not null check (warning_value >= 0),
  critical_value numeric(18, 6) not null check (critical_value >= warning_value),
  enabled boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risk_alerts (
  id bigint generated always as identity primary key,
  alert_key text not null unique,
  limit_id bigint references public.risk_limits(id) on delete set null,
  metric_key text not null,
  title text not null check (btrim(title) <> ''),
  entity_key text,
  entity_label text,
  level text not null check (level in ('attention', 'critical')),
  current_value numeric(18, 6) not null,
  threshold_value numeric(18, 6) not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risk_actions (
  id bigint generated always as identity primary key,
  alert_id bigint not null unique references public.risk_alerts(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  responsible text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists risk_limits_enabled_idx
  on public.risk_limits (enabled) where enabled = true;
create index if not exists risk_alerts_status_level_idx
  on public.risk_alerts (status, level);
create index if not exists risk_alerts_limit_id_idx
  on public.risk_alerts (limit_id);
create index if not exists risk_actions_status_due_date_idx
  on public.risk_actions (status, due_date);
create index if not exists risk_limits_created_by_idx on public.risk_limits (created_by);
create index if not exists risk_limits_updated_by_idx on public.risk_limits (updated_by);
create index if not exists risk_alerts_created_by_idx on public.risk_alerts (created_by);
create index if not exists risk_alerts_updated_by_idx on public.risk_alerts (updated_by);
create index if not exists risk_actions_created_by_idx on public.risk_actions (created_by);
create index if not exists risk_actions_updated_by_idx on public.risk_actions (updated_by);

alter table public.risk_limits enable row level security;
alter table public.risk_alerts enable row level security;
alter table public.risk_actions enable row level security;

revoke all on table public.risk_limits, public.risk_alerts, public.risk_actions from anon;
revoke all on sequence public.risk_limits_id_seq, public.risk_alerts_id_seq, public.risk_actions_id_seq from anon;

grant select, insert, update, delete
  on table public.risk_limits, public.risk_alerts, public.risk_actions
  to authenticated;
grant usage, select
  on sequence public.risk_limits_id_seq, public.risk_alerts_id_seq, public.risk_actions_id_seq
  to authenticated;

drop policy if exists "Administradores gerenciam limites de risco" on public.risk_limits;
create policy "Administradores gerenciam limites de risco"
on public.risk_limits
for all
to authenticated
using (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
)
with check (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
);

drop policy if exists "Administradores gerenciam alertas de risco" on public.risk_alerts;
create policy "Administradores gerenciam alertas de risco"
on public.risk_alerts
for all
to authenticated
using (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
)
with check (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
);

drop policy if exists "Administradores gerenciam providencias de risco" on public.risk_actions;
create policy "Administradores gerenciam providencias de risco"
on public.risk_actions
for all
to authenticated
using (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
)
with check (
  lower(((select auth.jwt()) ->> 'email')) = any (
    array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
  )
);

comment on table public.risk_limits is 'Limites de apetite de risco configurados no dashboard.';
comment on table public.risk_alerts is 'Alertas gerados pela comparação entre a carteira e os limites vigentes.';
comment on table public.risk_actions is 'Providências operacionais vinculadas aos alertas de risco.';
