-- One row per economic classification. Balances remain in secInfo/secInfoSmart.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create type public.arvore_cedentes_sacado_range as range (
  subtype = text,
  collation = "C"
);

create table public.arvore_cedentes (
  id uuid primary key default gen_random_uuid(),
  cedente_key text,
  sacado_key text,
  alcance text not null check (alcance in ('cedente', 'sacado', 'pendente')),
  cedente_nome text not null check (btrim(cedente_nome) <> ''),
  sacado_nome text,
  familia text not null check (btrim(familia) <> ''),
  setor text,
  finalidade text,
  aplicacao text,
  catalogo_versao text not null,
  dados jsonb not null check (jsonb_typeof(dados) = 'object'),
  revisao bigint not null default 1,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arvore_cedentes_escopo_check check (
    (alcance = 'pendente' and cedente_key is null and sacado_key is null)
    or (alcance = 'cedente' and cedente_key is not null and sacado_key is null)
    or (alcance = 'sacado' and cedente_key is not null and sacado_key is not null)
  ),
  constraint arvore_cedentes_sem_sobreposicao exclude using gist (
    cedente_key extensions.gist_text_ops with =,
    (case
      when alcance = 'cedente' then public.arvore_cedentes_sacado_range(null, null, '()')
      else public.arvore_cedentes_sacado_range(sacado_key, sacado_key, '[]')
    end) with &&
  ) where (alcance <> 'pendente')
);

create index arvore_cedentes_familia_idx on public.arvore_cedentes (familia);

create function public.set_arvore_cedentes_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revisao := old.revisao + 1;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_arvore_cedentes_update() from public;

create trigger set_arvore_cedentes_update
before update on public.arvore_cedentes
for each row execute function public.set_arvore_cedentes_update();

alter table public.arvore_cedentes enable row level security;
revoke all on table public.arvore_cedentes from anon, authenticated;
grant select on table public.arvore_cedentes to authenticated;
grant insert (id, cedente_key, sacado_key, alcance, cedente_nome, sacado_nome,
  familia, setor, finalidade, aplicacao, catalogo_versao, dados)
  on table public.arvore_cedentes to authenticated;
grant update (cedente_key, sacado_key, alcance, cedente_nome, sacado_nome,
  familia, setor, finalidade, aplicacao, catalogo_versao, dados)
  on table public.arvore_cedentes to authenticated;

create policy "Equipe autorizada visualiza arvore de cedentes"
on public.arvore_cedentes for select to authenticated
using (lower((select auth.jwt() ->> 'email')) = any (
  array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
));

create policy "Equipe autorizada inclui cedentes na arvore"
on public.arvore_cedentes for insert to authenticated
with check (lower((select auth.jwt() ->> 'email')) = any (
  array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
));

create policy "Equipe autorizada edita cedentes na arvore"
on public.arvore_cedentes for update to authenticated
using (lower((select auth.jwt() ->> 'email')) = any (
  array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
))
with check (lower((select auth.jwt() ->> 'email')) = any (
  array['daniel@adm.com.br', 'kesia@adm.com.br', 'eliene@adm.com.br', 'laerte@adm.com.br']
));

comment on table public.arvore_cedentes is
  'Classificacoes economicas de cedentes e sacados; saldos sao consultados na carteira.';
