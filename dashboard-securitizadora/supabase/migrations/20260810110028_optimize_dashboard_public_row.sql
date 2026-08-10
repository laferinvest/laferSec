-- Reaproveita o JSON da linha e remove apenas as colunas que os dashboards nao usam.
-- Isso evita reconstruir o objeto campo a campo para milhares de registros.
create or replace function public.dashboard_public_row(p_row_data jsonb, p_source_table text)
returns jsonb
language sql
stable
parallel safe
set search_path = ''
as $$
  select (
    p_row_data - array[
      'created_at',
      'Cód.Red',
      'UF',
      'Banco',
      'Rec.',
      'Estado',
      'Qtd Linhas Agrupadas',
      'Detalhes Agrupamento'
    ]::text[]
  ) || jsonb_build_object(
    'Status', coalesce(p_row_data ->> 'Status', p_row_data ->> 'Estado', ''),
    '_sourceTable', p_source_table
  );
$$;

revoke execute on function public.dashboard_public_row(jsonb, text) from public, anon;
grant execute on function public.dashboard_public_row(jsonb, text) to authenticated;
