-- Usa diretamente os tipos reais das tabelas para evitar conversoes JSON campo a campo no banco.
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
    to_jsonb(s),
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
    to_jsonb(s),
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

revoke execute on function public.dashboard_base_rows() from public, anon;
grant execute on function public.dashboard_base_rows() to authenticated;
