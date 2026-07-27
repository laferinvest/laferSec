create table if not exists public.grupos_economicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (btrim(nome) <> ''),
  prefixos text[] not null default '{}',
  ativo boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists grupos_economicos_nome_unique
  on public.grupos_economicos (lower(nome));

create or replace function public.set_grupos_economicos_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_grupos_economicos_updated_at
  on public.grupos_economicos;

create trigger set_grupos_economicos_updated_at
before update on public.grupos_economicos
for each row
execute function public.set_grupos_economicos_updated_at();

alter table public.grupos_economicos enable row level security;

revoke all on table public.grupos_economicos from anon;
grant select, insert, update, delete
  on table public.grupos_economicos
  to authenticated;

drop policy if exists "Usuarios autenticados podem visualizar grupos economicos"
  on public.grupos_economicos;

create policy "Usuarios autenticados podem visualizar grupos economicos"
on public.grupos_economicos
for select
to authenticated
using (true);

drop policy if exists "Administradores podem criar grupos economicos"
  on public.grupos_economicos;

create policy "Administradores podem criar grupos economicos"
on public.grupos_economicos
for insert
to authenticated
with check (
  lower((select auth.jwt() ->> 'email')) = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

drop policy if exists "Administradores podem editar grupos economicos"
  on public.grupos_economicos;

create policy "Administradores podem editar grupos economicos"
on public.grupos_economicos
for update
to authenticated
using (
  lower((select auth.jwt() ->> 'email')) = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
)
with check (
  lower((select auth.jwt() ->> 'email')) = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

drop policy if exists "Administradores podem excluir grupos economicos"
  on public.grupos_economicos;

create policy "Administradores podem excluir grupos economicos"
on public.grupos_economicos
for delete
to authenticated
using (
  lower((select auth.jwt() ->> 'email')) = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

insert into public.grupos_economicos (nome, prefixos)
values
  (
    'BDP Broadcast',
    array['BDP Broadcast']
  ),
  (
    'JL & D Confecções',
    array['JL & D Confecções']
  ),
  (
    'MG Packing',
    array[
      'Mg Embalagem e Separadores',
      'Mg Embalagem e Separadores Industria e Comercio LTDA',
      'MG Packing',
      'MG Packing Indústria, Com, Imp e Export de Embalagens LTDA'
    ]
  )
on conflict do nothing;

comment on table public.grupos_economicos is
  'Grupos econômicos configuráveis exibidos no Micro Dashboard.';

comment on column public.grupos_economicos.prefixos is
  'Nomes ou prefixos usados para identificar os cedentes integrantes do grupo.';
