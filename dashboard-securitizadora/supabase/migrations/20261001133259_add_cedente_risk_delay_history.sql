-- O mesmo fechamento diário guarda a carteira e todos os cedentes.
-- NULL distingue dias antigos, sem captura individual, de um fechamento vazio.
alter table public.risk_delay_history add column cedentes jsonb
  check (cedentes is null or jsonb_typeof(cedentes) = 'array');
comment on column public.risk_delay_history.cedentes is
  'Exposição vencida e em aberto por cedente no mesmo instante do fechamento da carteira. Percentual em fração, NULL se não houver crédito em aberto.';

create or replace function public.registrar_historico_atraso()
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
      regexp_replace(coalesce("Cliente", ''), '^\s+|\s+$', '', 'g') as cedente_original,
      regexp_replace(regexp_replace(regexp_replace(coalesce("Cliente", ''), '^\s+|\s+$', '', 'g'),
        '^\d+\s*-\s*', ''), '\s*-\s*sacado\s*$', '', 'i') as cedente,
      regexp_replace(coalesce("Sacado", ''), '^\s+|\s+$', '', 'g') as sacado,
      btrim(regexp_replace(regexp_replace(normalize(lower(coalesce("Status", '')), NFD),
        U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', ' ', 'g')) as status_normalizado,
      btrim(regexp_replace(normalize(lower(coalesce(inadimplencia, '')), NFD),
        U&'[\0300-\036f]', '', 'g')) as flag,
      "Vcto" + case extract(dow from "Vcto") when 6 then 2 when 0 then 1 else 0 end as vencimento_efetivo
    from source_rows
  ), identified as (
    select *, coalesce(nullif(btrim(regexp_replace(regexp_replace(normalize(lower(cedente), NFD),
      U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', ' ', 'g')), ''), 'nome:' || lower(cedente_original)) as cedente_key
    from normalized
  ), eligible as (
    select * from identified
    where cedente_original <> '' and sacado <> '' and sacado <> '0s'
      and sacado not like '0 s-%' and sacado not like '0s-%'
      and flag <> 'sim' and "Entrada" > 0 and "Pgto" is null and "Vcto" is not null
      and status_normalizado !~ '(^| )rec( |$)|recompr|refinanc'
  ), previous as (
    select cedentes from public.risk_delay_history where cedentes is not null
    order by data_referencia desc limit 1
  ), known_cedentes as (
    select cedente_key, max(coalesce(nullif(cedente, ''), cedente_original)) as cedente
    from identified where cedente_original <> '' group by cedente_key
    union all
    -- Conserva cedentes anteriores; se saíram da base, o saldo atual será zero.
    select item ->> 'cedente_key', item ->> 'cedente'
    from previous cross join lateral jsonb_array_elements(previous.cedentes) item
  ), names as (
    select cedente_key, max(cedente) as cedente from known_cedentes group by cedente_key
  ), per_cedente as (
    select cedente_key, sum("Entrada") as aberto,
      coalesce(sum("Entrada") filter (where vencimento_efetivo < reference_day), 0) as vencido,
      count(*) as quantidade,
      count(*) filter (where vencimento_efetivo < reference_day) as quantidade_vencida
    from eligible group by cedente_key
  ), cedente_snapshot as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'cedente_key', names.cedente_key, 'cedente', names.cedente,
      'exposicao_aberto', coalesce(per_cedente.aberto, 0),
      'exposicao_vencida', coalesce(per_cedente.vencido, 0),
      'percentual_atraso', per_cedente.vencido / nullif(per_cedente.aberto, 0),
      'titulos_aberto', coalesce(per_cedente.quantidade, 0),
      'titulos_vencidos', coalesce(per_cedente.quantidade_vencida, 0)
    ) order by names.cedente_key), '[]'::jsonb) as items
    from names left join per_cedente using (cedente_key)
  ), totals as (
    select coalesce(sum("Entrada"), 0) as aberto,
      coalesce(sum("Entrada") filter (where vencimento_efetivo < reference_day), 0) as vencido,
      count(*) as quantidade,
      count(*) filter (where vencimento_efetivo < reference_day) as quantidade_vencida
    from eligible
  )
  insert into public.risk_delay_history (
    data_referencia, exposicao_vencida, exposicao_aberto,
    titulos_aberto, titulos_vencidos, calculado_em, atualizado_por, cedentes
  )
  select reference_day, vencido, aberto, quantidade, quantidade_vencida, captured_at, auth.uid(), items
  from totals cross join cedente_snapshot
  on conflict (data_referencia) do update set
    exposicao_vencida = excluded.exposicao_vencida,
    exposicao_aberto = excluded.exposicao_aberto,
    titulos_aberto = excluded.titulos_aberto,
    titulos_vencidos = excluded.titulos_vencidos,
    calculado_em = excluded.calculado_em,
    atualizado_por = excluded.atualizado_por,
    cedentes = excluded.cedentes
  returning * into result;
  return result;
end;
$function$;

-- Retorna apenas a série escolhida, sem transferir todas as empresas de todos os dias.
create function public.consultar_historico_atraso_cedente(chave_cedente text)
returns table (data_referencia date, exposicao_vencida numeric, exposicao_aberto numeric,
  percentual_atraso numeric, calculado_em timestamptz)
language sql stable security invoker set search_path = ''
as $function$
  select history.data_referencia, (item ->> 'exposicao_vencida')::numeric,
    (item ->> 'exposicao_aberto')::numeric, (item ->> 'percentual_atraso')::numeric, history.calculado_em
  from public.risk_delay_history history
  cross join lateral jsonb_array_elements(history.cedentes) item
  where item ->> 'cedente_key' = chave_cedente;
$function$;
revoke all on function public.consultar_historico_atraso_cedente(text) from public, anon;
grant execute on function public.consultar_historico_atraso_cedente(text) to authenticated;
revoke all on function public.registrar_historico_atraso() from public, anon;
grant execute on function public.registrar_historico_atraso() to authenticated;
