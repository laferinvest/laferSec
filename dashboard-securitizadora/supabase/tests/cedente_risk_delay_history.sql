-- Executar como postgres; capturas e alteração de teste são revertidas.
begin;
select set_config('request.jwt.claims', (
  select json_build_object('sub', id, 'email', email, 'role', 'authenticated')::text
  from auth.users where lower(email) = any (
    array['daniel@adm.com.br','kesia@adm.com.br','eliene@adm.com.br','laerte@adm.com.br']
  ) order by created_at limit 1
), true) is not null as usuario_teste_disponivel;
set local role authenticated;
do $test$
declare
  captured public.risk_delay_history;
  second_capture public.risk_delay_history;
  item jsonb;
  total_open numeric;
  total_overdue numeric;
begin
  captured := public.registrar_historico_atraso();
  if captured.cedentes is null then raise exception 'Sem captura individual'; end if;
  select coalesce(sum((value ->> 'exposicao_aberto')::numeric), 0),
    coalesce(sum((value ->> 'exposicao_vencida')::numeric), 0)
    into total_open, total_overdue from jsonb_array_elements(captured.cedentes);
  if total_open <> captured.exposicao_aberto or total_overdue <> captured.exposicao_vencida then
    raise exception 'Soma dos cedentes não fecha com a carteira';
  end if;
  if (select count(*) from jsonb_array_elements(captured.cedentes)) <>
    (select count(distinct value ->> 'cedente_key') from jsonb_array_elements(captured.cedentes)) then
    raise exception 'Cedente duplicado no fechamento';
  end if;
  for item in select value from jsonb_array_elements(captured.cedentes) loop
    if (item ->> 'percentual_atraso')::numeric is distinct from
      (item ->> 'exposicao_vencida')::numeric / nullif((item ->> 'exposicao_aberto')::numeric, 0) then
      raise exception 'Percentual não usa o crédito em aberto do próprio cedente';
    end if;
    if not exists (
      select 1 from public.consultar_historico_atraso_cedente(item ->> 'cedente_key') series
      where series.data_referencia = captured.data_referencia
        and series.exposicao_aberto = (item ->> 'exposicao_aberto')::numeric
        and series.percentual_atraso is not distinct from (item ->> 'percentual_atraso')::numeric
    ) then raise exception 'Série individual não corresponde ao fechamento'; end if;
  end loop;
  -- Um cedente que desaparece da base não pode conservar um saldo antigo.
  update public.risk_delay_history set cedentes = cedentes || jsonb_build_array(jsonb_build_object(
    'cedente_key', '__cedente_removido_teste__', 'cedente', 'Cedente removido (teste)',
    'exposicao_aberto', 100, 'exposicao_vencida', 50, 'percentual_atraso', 0.5
  )) where data_referencia = captured.data_referencia;
  second_capture := public.registrar_historico_atraso();
  select value into item from jsonb_array_elements(second_capture.cedentes)
  where value ->> 'cedente_key' = '__cedente_removido_teste__';
  if item is null or (item ->> 'exposicao_aberto')::numeric <> 0 or item ->> 'percentual_atraso' is not null then
    raise exception 'Cedente removido conservou saldo/percentual antigo';
  end if;
  if (select count(*) from public.risk_delay_history where data_referencia = captured.data_referencia) <> 1
    or second_capture.calculado_em <= captured.calculado_em then
    raise exception 'Segunda atualização do dia não substituiu o fechamento';
  end if;
end;
$test$;
select set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'email', 'sem-acesso@example.invalid', 'role', 'authenticated')::text, true) is not null;
do $test$
begin
  if exists (select 1 from public.consultar_historico_atraso_cedente('__cedente_removido_teste__')) then
    raise exception 'Série individual exposta para usuário sem acesso';
  end if;
end;
$test$;
reset role;
do $test$
begin
  if has_function_privilege('anon', 'public.consultar_historico_atraso_cedente(text)', 'EXECUTE')
    or (select prosecdef from pg_proc where oid='public.consultar_historico_atraso_cedente(text)'::regprocedure) then
    raise exception 'Permissões incorretas na consulta individual';
  end if;
end;
$test$;
rollback;
select 'OK: carteira e cedentes conferem; último cálculo do dia substitui o anterior; teste revertido' as resultado;
