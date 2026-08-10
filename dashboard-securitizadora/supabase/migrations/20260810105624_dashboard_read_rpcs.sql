-- RPCs de leitura para reduzir o volume transferido aos dashboards e ao navegador.
-- Todas as funções são SECURITY INVOKER: as políticas RLS das tabelas continuam válidas.

create or replace function public.dashboard_normalize_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(
    translate(
      lower(coalesce(p_value, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    )
  );
$$;

create or replace function public.dashboard_try_date(p_value text)
returns date
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_value text := split_part(trim(coalesce(p_value, '')), 'T', 1);
  v_parts text[];
begin
  if v_value = '' then
    return null;
  end if;

  if v_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_parts := string_to_array(v_value, '-');
    return make_date(v_parts[1]::integer, v_parts[2]::integer, v_parts[3]::integer);
  end if;

  if v_value ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
    v_parts := string_to_array(v_value, '/');
    return make_date(v_parts[3]::integer, v_parts[2]::integer, v_parts[1]::integer);
  end if;

  return null;
exception
  when others then
    return null;
end;
$$;

create or replace function public.dashboard_try_numeric(p_value text)
returns numeric
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_value text := regexp_replace(trim(coalesce(p_value, '')), '[[:space:]]+', '', 'g');
begin
  if v_value = '' then
    return 0;
  end if;

  if position(',' in v_value) > 0 then
    v_value := replace(replace(v_value, '.', ''), ',', '.');
  end if;

  v_value := regexp_replace(v_value, '[^0-9.-]', '', 'g');
  if v_value = '' or v_value = '-' then
    return 0;
  end if;

  return v_value::numeric;
exception
  when others then
    return 0;
end;
$$;

create or replace function public.dashboard_next_weekday(p_date date)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case extract(dow from p_date)::integer
    when 6 then p_date + 2
    when 0 then p_date + 1
    else p_date
  end;
$$;

create or replace function public.dashboard_add_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_date date := p_date;
  v_added integer := 0;
begin
  while v_added < greatest(coalesce(p_days, 0), 0) loop
    v_date := v_date + 1;
    if extract(dow from v_date)::integer not in (0, 6) then
      v_added := v_added + 1;
    end if;
  end loop;
  return v_date;
end;
$$;

create or replace function public.dashboard_row_status(
  p_vcto date,
  p_pgto date,
  p_status text,
  p_cliente text,
  p_today date,
  p_use_tolerance boolean default false
)
returns text
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  v_status text := upper(trim(coalesce(p_status, '')));
  v_vcto date;
  v_limit date;
  v_tolerance integer := 0;
begin
  if v_status like '%REC%' then
    return 'recompra';
  end if;

  if p_vcto is null then
    return 'invalido';
  end if;

  v_vcto := public.dashboard_next_weekday(p_vcto);

  if p_use_tolerance and public.dashboard_normalize_text(v_status) like '%refinanc%' then
    return 'aVencer';
  end if;

  if p_use_tolerance then
    if trim(coalesce(p_cliente, '')) like '160 -%' or trim(coalesce(p_cliente, '')) like '260 -%' then
      v_tolerance := 2;
    elsif trim(coalesce(p_cliente, '')) like '466 -%' or trim(coalesce(p_cliente, '')) like '479 -%' then
      v_tolerance := 1;
    end if;
  end if;

  v_limit := public.dashboard_add_business_days(v_vcto, v_tolerance);

  if p_pgto is not null then
    return case when p_pgto <= v_limit then 'liquidado' else 'liquidadoAtraso' end;
  end if;

  return case when v_vcto < p_today then 'atraso' else 'aVencer' end;
end;
$$;

create or replace function public.dashboard_base_rows()
returns table (
  source_table text,
  row_data jsonb,
  id_text text,
  cliente text,
  sacado text,
  dt_emis date,
  vcto date,
  pgto date,
  entrada numeric,
  vl_pgto numeric,
  dcto text,
  bordero text,
  desagio numeric,
  juros_multa numeric,
  tx_efet numeric,
  status_text text,
  inadimplencia text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with source_rows as (
    select 'secInfo'::text as source_table, to_jsonb(s) as row_data
    from public."secInfo" s
    union all
    select 'secInfoSmart'::text as source_table, to_jsonb(s) as row_data
    from public."secInfoSmart" s
  )
  select
    source_table,
    row_data,
    row_data ->> 'id' as id_text,
    coalesce(row_data ->> 'Cliente', '') as cliente,
    coalesce(row_data ->> 'Sacado', '') as sacado,
    public.dashboard_try_date(row_data ->> 'Dt.Emis') as dt_emis,
    public.dashboard_try_date(row_data ->> 'Vcto') as vcto,
    public.dashboard_try_date(row_data ->> 'Pgto') as pgto,
    public.dashboard_try_numeric(row_data ->> 'Entrada') as entrada,
    public.dashboard_try_numeric(row_data ->> 'Vl Pgto') as vl_pgto,
    coalesce(row_data ->> 'Dcto', '') as dcto,
    coalesce(row_data ->> 'Borderô', '') as bordero,
    public.dashboard_try_numeric(row_data ->> 'Desagio') as desagio,
    public.dashboard_try_numeric(row_data ->> 'Juros e Multa') as juros_multa,
    public.dashboard_try_numeric(row_data ->> 'Tx.Efet') as tx_efet,
    coalesce(row_data ->> 'Status', row_data ->> 'Estado', '') as status_text,
    coalesce(row_data ->> 'inadimplencia', '') as inadimplencia
  from source_rows;
$$;

create or replace function public.dashboard_is_valid_row(
  p_cliente text,
  p_sacado text,
  p_inadimplencia text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    trim(coalesce(p_cliente, '')) <> ''
    and trim(coalesce(p_sacado, '')) <> ''
    and public.dashboard_normalize_text(p_sacado) not in ('0s')
    and public.dashboard_normalize_text(p_sacado) not like '0 s-%'
    and public.dashboard_normalize_text(p_sacado) not like '0s-%'
    and public.dashboard_normalize_text(p_inadimplencia) <> 'sim';
$$;

create or replace function public.dashboard_public_row(p_row_data jsonb, p_source_table text)
returns jsonb
language sql
stable
parallel safe
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row_data -> 'id',
    'Cliente', p_row_data -> 'Cliente',
    'Sacado', p_row_data -> 'Sacado',
    'Dt.Emis', p_row_data -> 'Dt.Emis',
    'Vcto', p_row_data -> 'Vcto',
    'Pgto', p_row_data -> 'Pgto',
    'Vl Pgto', p_row_data -> 'Vl Pgto',
    'Dcto', p_row_data -> 'Dcto',
    'Borderô', p_row_data -> 'Borderô',
    'Entrada', p_row_data -> 'Entrada',
    'Desagio', p_row_data -> 'Desagio',
    'Juros e Multa', p_row_data -> 'Juros e Multa',
    'Tx.Efet', p_row_data -> 'Tx.Efet',
    'Status', coalesce(p_row_data -> 'Status', p_row_data -> 'Estado'),
    'inadimplencia', p_row_data -> 'inadimplencia',
    '_sourceTable', to_jsonb(p_source_table)
  );
$$;

create or replace function public.dashboard_resumo_matinal_rows(
  p_selected_date date,
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_current_week_start date := p_today - ((extract(dow from p_today)::integer + 6) % 7);
  v_current_week_end date := v_current_week_start + 6;
  v_previous_week_start date := v_current_week_start - 7;
  v_previous_month_start date := (date_trunc('month', p_today)::date - interval '1 month')::date;
  v_operation_date date := case when extract(dow from p_selected_date)::integer = 0 then p_selected_date - 2 else p_selected_date end;
  v_payment_start date := case when extract(dow from p_selected_date)::integer = 0 then p_selected_date - 2 else p_selected_date end;
  v_payment_end date := p_selected_date;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(public.dashboard_public_row(r.row_data, r.source_table) order by r.vcto desc nulls last, r.id_text desc), '[]'::jsonb)
  into v_result
  from public.dashboard_base_rows() r
  where public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
    and r.entrada > 0
    and (
      r.dt_emis = v_operation_date
      or r.dt_emis between v_previous_week_start and (v_current_week_start - 1)
      or r.vcto between (v_operation_date - 2) and v_operation_date
      or r.vcto between (v_previous_month_start - 7) and v_current_week_end
      or r.pgto between v_payment_start and v_payment_end
    );

  return v_result;
end;
$$;

create or replace function public.dashboard_macro_rows(p_today date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.dashboard_public_row(r.row_data, r.source_table) order by r.id_text desc), '[]'::jsonb)
  from public.dashboard_base_rows() r
  where public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
    and r.entrada > 0
    and (
      r.pgto is null
      or r.dt_emis >= least(
        date_trunc('year', p_today)::date,
        (date_trunc('month', p_today)::date - interval '2 months')::date,
        p_today - 30
      )
      or r.vcto >= least(
        date_trunc('year', p_today)::date,
        (date_trunc('month', p_today)::date - interval '2 months')::date,
        p_today - 30
      )
    );
$$;

create or replace function public.dashboard_micro_relationships(
  p_sources text[] default array['secInfo', 'secInfoSmart']::text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'Cliente', pairs.cliente,
        'Sacado', pairs.sacado,
        'inadimplencia', pairs.inadimplencia,
        '_sourceTable', pairs.source_table
      )
      order by pairs.cliente, pairs.sacado
    ),
    '[]'::jsonb
  )
  from (
    select distinct r.source_table, r.cliente, r.sacado, r.inadimplencia
    from public.dashboard_base_rows() r
    where r.source_table = any(p_sources)
      and public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
  ) pairs;
$$;

create or replace function public.dashboard_micro_rows(
  p_sources text[] default array['secInfo', 'secInfoSmart']::text[],
  p_clientes text[] default null,
  p_sacados text[] default null,
  p_grupo_prefixos text[] default null,
  p_date_field text default 'emis',
  p_start date default null,
  p_end date default null,
  p_bordero text default null,
  p_dcto_prefix text default null,
  p_today date default current_date,
  p_limit integer default 20000,
  p_only_open boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select
      r.*,
      public.dashboard_row_status(r.vcto, r.pgto, r.status_text, r.cliente, p_today, true) as row_status,
      case when lower(coalesce(p_date_field, 'emis')) = 'vcto' then r.vcto else r.dt_emis end as filter_date
    from public.dashboard_base_rows() r
    where r.source_table = any(p_sources)
      and public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
      and r.entrada > 0
      and (p_clientes is null or cardinality(p_clientes) = 0 or r.cliente = any(p_clientes))
      and (p_sacados is null or cardinality(p_sacados) = 0 or r.sacado = any(p_sacados))
      and (
        p_grupo_prefixos is null
        or cardinality(p_grupo_prefixos) = 0
        or exists (
          select 1
          from unnest(p_grupo_prefixos) as prefixes(prefixo)
          where lower(r.cliente) like lower(prefixo) || '%'
        )
      )
      and (p_bordero is null or r.bordero = p_bordero)
      and (p_dcto_prefix is null or lower(r.dcto) like lower(p_dcto_prefix) || '%')
  ), relevant as (
    select *
    from scoped
    where
      (
        p_only_open
        and row_status in ('aVencer', 'atraso')
      )
      or (
        not p_only_open
        and (
          (p_start is null and p_end is null)
          or (
            (p_start is null or filter_date >= p_start)
            and (p_end is null or filter_date <= p_end)
          )
          or row_status in ('aVencer', 'atraso')
        )
      )
    order by id_text desc
    limit least(greatest(coalesce(p_limit, 20000), 1), 50000)
  )
  select coalesce(jsonb_agg(public.dashboard_public_row(r.row_data, r.source_table) order by r.id_text desc), '[]'::jsonb)
  from relevant r;
$$;

create or replace function public.dashboard_micro_evolution(
  p_sources text[] default array['secInfo', 'secInfoSmart']::text[],
  p_clientes text[] default null,
  p_sacados text[] default null,
  p_grupo_prefixos text[] default null,
  p_view_mode text default 'all',
  p_insight_status text default null,
  p_today date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select
      r.*,
      public.dashboard_row_status(r.vcto, r.pgto, r.status_text, r.cliente, p_today, true) as row_status,
      public.dashboard_next_weekday(r.vcto) as operational_vcto,
      to_char(r.dt_emis, 'YYYY-MM') as emis_month,
      to_char(r.vcto, 'YYYY-MM') as vcto_month,
      coalesce(nullif(r.bordero, ''), 'avulso_' || r.id_text) as border_key
    from public.dashboard_base_rows() r
    where r.source_table = any(p_sources)
      and public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
      and r.entrada > 0
      and (p_clientes is null or cardinality(p_clientes) = 0 or r.cliente = any(p_clientes))
      and (p_sacados is null or cardinality(p_sacados) = 0 or r.sacado = any(p_sacados))
      and (
        p_grupo_prefixos is null
        or cardinality(p_grupo_prefixos) = 0
        or exists (
          select 1
          from unnest(p_grupo_prefixos) as prefixes(prefixo)
          where lower(r.cliente) like lower(prefixo) || '%'
        )
      )
  ), status_filtered as (
    select *
    from filtered
    where
      (coalesce(p_view_mode, 'all') = 'all')
      or (p_view_mode = 'open' and row_status in ('aVencer', 'atraso'))
      or (p_view_mode = 'finalized' and row_status not in ('aVencer', 'atraso'))
  ), scoped as (
    select *
    from status_filtered
    where p_insight_status is null or row_status = p_insight_status
  ), months as (
    select emis_month as ym from scoped where emis_month is not null
    union
    select vcto_month as ym from scoped where vcto_month is not null
  ), volume_month as (
    select emis_month as ym, sum(entrada) as value
    from scoped
    where emis_month is not null
    group by emis_month
  ), delay_month as (
    select
      vcto_month as ym,
      count(*) filter (where row_status not in ('invalido', 'aVencer')) as total_finalized,
      count(*) filter (where row_status in ('liquidadoAtraso', 'atraso', 'recompra')) as delayed_count,
      sum(greatest(0, coalesce(pgto, p_today) - operational_vcto))
        filter (where row_status in ('liquidadoAtraso', 'atraso', 'recompra')) as delay_days,
      count(*) filter (
        where row_status in ('liquidadoAtraso', 'atraso', 'recompra')
          and coalesce(pgto, p_today) > operational_vcto
      ) as delay_count
    from scoped
    where vcto_month is not null
    group by vcto_month
  ), rate_bordero as (
    select emis_month as ym, source_table, border_key, sum(entrada) as face, max(tx_efet) as rate
    from scoped
    where emis_month is not null
    group by emis_month, source_table, border_key
  ), rate_month as (
    select ym, sum(face * rate) / nullif(sum(face), 0) as avg_rate
    from rate_bordero
    group by ym
  ), desagio_items as (
    select
      emis_month as ym,
      source_table,
      case when source_table = 'secInfoSmart' then 'titulo_' || id_text else border_key end as item_key,
      max(desagio) as amount
    from scoped
    where emis_month is not null
    group by emis_month, source_table,
      case when source_table = 'secInfoSmart' then 'titulo_' || id_text else border_key end
  ), desagio_month as (
    select ym, sum(amount) as value
    from desagio_items
    group by ym
  ), prazo_month as (
    select
      emis_month as ym,
      sum((vcto - dt_emis) * entrada) / nullif(sum(entrada), 0) as prazo_medio,
      count(*) as titulos
    from scoped
    where emis_month is not null and dt_emis is not null and vcto > dt_emis
    group by emis_month
  ), chart_rows as (
    select
      m.ym,
      coalesce(v.value, 0) as value,
      case when coalesce(d.total_finalized, 0) > 0
        then coalesce(d.delayed_count, 0)::numeric / d.total_finalized * 100
        else 0
      end as pct_atraso,
      case when coalesce(d.delay_count, 0) > 0
        then coalesce(d.delay_days, 0)::numeric / d.delay_count
        else 0
      end as avg_delay_days,
      coalesce(d.delay_count, 0) as delay_count
    from months m
    left join volume_month v using (ym)
    left join delay_month d using (ym)
    where m.ym <= to_char(p_today, 'YYYY-MM')
  )
  select jsonb_build_object(
    'chartData', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ym', ym,
        'value', value,
        'pctAtraso', pct_atraso,
        'avgDelayDays', avg_delay_days,
        'delayCount', delay_count
      ) order by ym) from chart_rows
    ), '[]'::jsonb),
    'chartDataRate', coalesce((
      select jsonb_agg(jsonb_build_object('ym', m.ym, 'avgRate', coalesce(r.avg_rate, 0)) order by m.ym)
      from months m
      left join rate_month r using (ym)
      where m.ym <= to_char(p_today, 'YYYY-MM')
    ), '[]'::jsonb),
    'chartDataDesagio', coalesce((
      select jsonb_agg(jsonb_build_object('ym', m.ym, 'value', coalesce(d.value, 0)) order by m.ym)
      from months m
      left join desagio_month d using (ym)
      where m.ym <= to_char(p_today, 'YYYY-MM')
    ), '[]'::jsonb),
    'chartDataPrazoMedio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ym', m.ym,
        'prazoMedio', coalesce(p.prazo_medio, 0),
        'titulos', coalesce(p.titulos, 0)
      ) order by m.ym)
      from months m
      left join prazo_month p using (ym)
      where m.ym <= to_char(p_today, 'YYYY-MM')
    ), '[]'::jsonb),
    'chartDataVencimentos', jsonb_build_array(
      jsonb_build_object('key', '0_7', 'label', '7 dias', 'minDays', 0, 'maxDays', 7,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today between 0 and 7), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today between 0 and 7)),
      jsonb_build_object('key', '8_15', 'label', '7-15 dias', 'minDays', 8, 'maxDays', 15,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today between 8 and 15), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today between 8 and 15)),
      jsonb_build_object('key', '16_30', 'label', '15-30 dias', 'minDays', 16, 'maxDays', 30,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today between 16 and 30), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today between 16 and 30)),
      jsonb_build_object('key', '31_60', 'label', '1-2 meses', 'minDays', 31, 'maxDays', 60,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today between 31 and 60), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today between 31 and 60)),
      jsonb_build_object('key', '61_90', 'label', '2-3 meses', 'minDays', 61, 'maxDays', 90,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today between 61 and 90), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today between 61 and 90)),
      jsonb_build_object('key', '91_plus', 'label', '3+ meses', 'minDays', 91, 'maxDays', null,
        'value', coalesce((select sum(entrada) from scoped where row_status = 'aVencer' and vcto - p_today >= 91), 0),
        'count', (select count(*) from scoped where row_status = 'aVencer' and vcto - p_today >= 91))
    )
  );
$$;

revoke execute on function public.dashboard_normalize_text(text) from public, anon;
revoke execute on function public.dashboard_try_date(text) from public, anon;
revoke execute on function public.dashboard_try_numeric(text) from public, anon;
revoke execute on function public.dashboard_next_weekday(date) from public, anon;
revoke execute on function public.dashboard_add_business_days(date, integer) from public, anon;
revoke execute on function public.dashboard_row_status(date, date, text, text, date, boolean) from public, anon;
revoke execute on function public.dashboard_base_rows() from public, anon;
revoke execute on function public.dashboard_is_valid_row(text, text, text) from public, anon;
revoke execute on function public.dashboard_public_row(jsonb, text) from public, anon;
revoke execute on function public.dashboard_resumo_matinal_rows(date, date) from public, anon;
revoke execute on function public.dashboard_macro_rows(date) from public, anon;
revoke execute on function public.dashboard_micro_relationships(text[]) from public, anon;
revoke execute on function public.dashboard_micro_rows(text[], text[], text[], text[], text, date, date, text, text, date, integer, boolean) from public, anon;
revoke execute on function public.dashboard_micro_evolution(text[], text[], text[], text[], text, text, date) from public, anon;

grant execute on function public.dashboard_normalize_text(text) to authenticated;
grant execute on function public.dashboard_try_date(text) to authenticated;
grant execute on function public.dashboard_try_numeric(text) to authenticated;
grant execute on function public.dashboard_next_weekday(date) to authenticated;
grant execute on function public.dashboard_add_business_days(date, integer) to authenticated;
grant execute on function public.dashboard_row_status(date, date, text, text, date, boolean) to authenticated;
grant execute on function public.dashboard_base_rows() to authenticated;
grant execute on function public.dashboard_is_valid_row(text, text, text) to authenticated;
grant execute on function public.dashboard_public_row(jsonb, text) to authenticated;
grant execute on function public.dashboard_resumo_matinal_rows(date, date) to authenticated;
grant execute on function public.dashboard_macro_rows(date) to authenticated;
grant execute on function public.dashboard_micro_relationships(text[]) to authenticated;
grant execute on function public.dashboard_micro_rows(text[], text[], text[], text[], text, date, date, text, text, date, integer, boolean) to authenticated;
grant execute on function public.dashboard_micro_evolution(text[], text[], text[], text[], text, text, date) to authenticated;

comment on function public.dashboard_resumo_matinal_rows(date, date) is
  'Retorna somente as linhas potencialmente usadas pelos blocos do Resumo Matinal.';
comment on function public.dashboard_macro_rows(date) is
  'Retorna carteira aberta e movimentos do ano usados pelo dashboard de Carteira e Concentração.';
comment on function public.dashboard_micro_rows(text[], text[], text[], text[], text, date, date, text, text, date, integer, boolean) is
  'Retorna o período selecionado e a carteira aberta necessários ao dashboard de Operações e Recebíveis.';
comment on function public.dashboard_micro_evolution(text[], text[], text[], text[], text, text, date) is
  'Retorna séries mensais agregadas do dashboard de Operações e Recebíveis.';
