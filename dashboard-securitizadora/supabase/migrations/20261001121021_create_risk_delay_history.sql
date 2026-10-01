-- Um fechamento por dia de atualização, no calendário de Brasília.
create table public.risk_delay_history (
  data_referencia date primary key,
  exposicao_vencida numeric not null check (exposicao_vencida >= 0),
  exposicao_aberto numeric not null check (exposicao_aberto >= exposicao_vencida),
  percentual_atraso numeric generated always as (
    exposicao_vencida / nullif(exposicao_aberto, 0)
  ) stored,
  titulos_aberto bigint not null check (titulos_aberto >= 0),
  titulos_vencidos bigint not null check (titulos_vencidos between 0 and titulos_aberto),
  calculado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

create index risk_delay_history_atualizado_por_idx on public.risk_delay_history (atualizado_por);
alter table public.risk_delay_history enable row level security;
revoke all on public.risk_delay_history from anon, authenticated;
grant select, insert, update on public.risk_delay_history to authenticated;

create policy "Administradores consultam e registram historico de atraso"
on public.risk_delay_history for all to authenticated
using (
  lower((select auth.jwt()) ->> 'email') = any (
    array['daniel@adm.com.br','kesia@adm.com.br','eliene@adm.com.br','laerte@adm.com.br']
  )
)
with check (
  lower((select auth.jwt()) ->> 'email') = any (
    array['daniel@adm.com.br','kesia@adm.com.br','eliene@adm.com.br','laerte@adm.com.br']
  )
);

-- Chamado somente ao concluir a importação inteira, nunca por linha/lote.
-- SECURITY INVOKER conserva as permissões e RLS das duas bases.
create function public.registrar_historico_atraso()
returns public.risk_delay_history
language plpgsql security invoker set search_path = ''
as $function$
declare
  reference_day date;
  captured_at timestamptz;
  result public.risk_delay_history;
begin
  if auth.uid() is null or not coalesce(
    lower(auth.jwt() ->> 'email') = any (
      array['daniel@adm.com.br','kesia@adm.com.br','eliene@adm.com.br','laerte@adm.com.br']
    ), false
  ) then
    raise exception 'Acesso não autorizado ao histórico de atraso.' using errcode = '42501';
  end if;

  -- Serializa capturas concorrentes; cada chamada lê a base após obter o lock.
  perform pg_catalog.pg_advisory_xact_lock(741260011);
  captured_at := pg_catalog.clock_timestamp();
  reference_day := (captured_at at time zone 'America/Sao_Paulo')::date;

  with source_rows as (
    select "Cliente", "Sacado", "Vcto", "Pgto", "Entrada", "Status", inadimplencia
    from public."secInfo"
    union all
    select "Cliente", "Sacado", "Vcto", "Pgto", "Entrada", "Status", inadimplencia
    from public."secInfoSmart"
  ), normalized as (
    select *,
      regexp_replace(coalesce("Cliente", ''), '^\s+|\s+$', '', 'g') as cedente,
      regexp_replace(coalesce("Sacado", ''), '^\s+|\s+$', '', 'g') as sacado,
      btrim(regexp_replace(regexp_replace(normalize(lower(coalesce("Status", '')), NFD),
        U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', ' ', 'g')) as status_normalizado,
      btrim(regexp_replace(normalize(lower(coalesce(inadimplencia, '')), NFD),
        U&'[\0300-\036f]', '', 'g')) as flag,
      "Vcto" + case extract(dow from "Vcto") when 6 then 2 when 0 then 1 else 0 end as vencimento_efetivo
    from source_rows
  ), eligible as (
    select * from normalized
    where cedente <> '' and sacado <> '' and sacado <> '0s'
      and sacado not like '0 s-%' and sacado not like '0s-%'
      and flag <> 'sim' and "Entrada" > 0 and "Pgto" is null and "Vcto" is not null
      and status_normalizado !~ '(^| )rec( |$)|recompr|refinanc'
  ), totals as (
    select coalesce(sum("Entrada"), 0) as aberto,
      coalesce(sum("Entrada") filter (where vencimento_efetivo < reference_day), 0) as vencido,
      count(*) as quantidade,
      count(*) filter (where vencimento_efetivo < reference_day) as quantidade_vencida
    from eligible
  )
  insert into public.risk_delay_history (
    data_referencia, exposicao_vencida, exposicao_aberto,
    titulos_aberto, titulos_vencidos, calculado_em, atualizado_por
  )
  select reference_day, vencido, aberto, quantidade, quantidade_vencida, captured_at, auth.uid()
  from totals
  on conflict (data_referencia) do update set
    exposicao_vencida = excluded.exposicao_vencida,
    exposicao_aberto = excluded.exposicao_aberto,
    titulos_aberto = excluded.titulos_aberto,
    titulos_vencidos = excluded.titulos_vencidos,
    calculado_em = excluded.calculado_em,
    atualizado_por = excluded.atualizado_por
  returning * into result;
  return result;
end;
$function$;

revoke all on function public.registrar_historico_atraso() from public, anon;
grant execute on function public.registrar_historico_atraso() to authenticated;
comment on table public.risk_delay_history is
  'Última exposição vencida / exposição em aberto após atualização da base em cada dia (America/Sao_Paulo). Sem exposição, percentual NULL. Mesmas exclusões e ajuste de fim de semana de Riscos e Alertas.';
