-- Evita criar JSON por linha nas RPCs que precisam apenas calcular agregados.
create or replace function public.dashboard_typed_rows()
returns table (
  source_table text,
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
  tx_efet numeric,
  status_text text,
  inadimplencia text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    'secInfo'::text,
    s.id::text,
    coalesce(s."Cliente", ''),
    coalesce(s."Sacado", ''),
    s."Dt.Emis",
    s."Vcto",
    s."Pgto",
    coalesce(s."Entrada", 0),
    coalesce(s."Vl Pgto", 0),
    coalesce(s."Dcto", ''),
    coalesce(s."Borderô"::text, ''),
    coalesce(s."Desagio", 0),
    coalesce(s."Tx.Efet", 0),
    coalesce(s."Status", s."Estado", ''),
    coalesce(s."inadimplencia", '')
  from public."secInfo" s

  union all

  select
    'secInfoSmart'::text,
    s.id::text,
    coalesce(s."Cliente", ''),
    coalesce(s."Sacado", ''),
    s."Dt.Emis",
    s."Vcto",
    s."Pgto",
    coalesce(s."Entrada", 0),
    coalesce(s."Vl Pgto", 0),
    coalesce(s."Dcto", ''),
    coalesce(s."Borderô"::text, ''),
    coalesce(s."Desagio", 0),
    coalesce(s."Tx.Efet", 0),
    coalesce(s."Status", s."Estado", ''),
    coalesce(s."inadimplencia", '')
  from public."secInfoSmart" s;
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
    from public.dashboard_typed_rows() r
    where r.source_table = any(p_sources)
      and public.dashboard_is_valid_row(r.cliente, r.sacado, r.inadimplencia)
  ) pairs;
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
    from public.dashboard_typed_rows() r
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
      coalesce(p_view_mode, 'all') = 'all'
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
  ), due_totals as (
    select
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today between 0 and 7), 0) as value_0_7,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today between 0 and 7) as count_0_7,
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today between 8 and 15), 0) as value_8_15,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today between 8 and 15) as count_8_15,
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today between 16 and 30), 0) as value_16_30,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today between 16 and 30) as count_16_30,
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today between 31 and 60), 0) as value_31_60,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today between 31 and 60) as count_31_60,
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today between 61 and 90), 0) as value_61_90,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today between 61 and 90) as count_61_90,
      coalesce(sum(entrada) filter (where row_status = 'aVencer' and vcto - p_today >= 91), 0) as value_91_plus,
      count(*) filter (where row_status = 'aVencer' and vcto - p_today >= 91) as count_91_plus
    from scoped
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
    'chartDataVencimentos', (
      select jsonb_build_array(
        jsonb_build_object('key', '0_7', 'label', '7 dias', 'minDays', 0, 'maxDays', 7, 'value', value_0_7, 'count', count_0_7),
        jsonb_build_object('key', '8_15', 'label', '7-15 dias', 'minDays', 8, 'maxDays', 15, 'value', value_8_15, 'count', count_8_15),
        jsonb_build_object('key', '16_30', 'label', '15-30 dias', 'minDays', 16, 'maxDays', 30, 'value', value_16_30, 'count', count_16_30),
        jsonb_build_object('key', '31_60', 'label', '1-2 meses', 'minDays', 31, 'maxDays', 60, 'value', value_31_60, 'count', count_31_60),
        jsonb_build_object('key', '61_90', 'label', '2-3 meses', 'minDays', 61, 'maxDays', 90, 'value', value_61_90, 'count', count_61_90),
        jsonb_build_object('key', '91_plus', 'label', '3+ meses', 'minDays', 91, 'maxDays', null, 'value', value_91_plus, 'count', count_91_plus)
      )
      from due_totals
    )
  );
$$;

revoke execute on function public.dashboard_typed_rows() from public, anon;
revoke execute on function public.dashboard_micro_relationships(text[]) from public, anon;
revoke execute on function public.dashboard_micro_evolution(text[], text[], text[], text[], text, text, date) from public, anon;

grant execute on function public.dashboard_typed_rows() to authenticated;
grant execute on function public.dashboard_micro_relationships(text[]) to authenticated;
grant execute on function public.dashboard_micro_evolution(text[], text[], text[], text[], text, text, date) to authenticated;
