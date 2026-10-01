-- Executar no SQL Editor como postgres. Todas as alterações do teste são revertidas.
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
  first_capture public.risk_delay_history;
  second_capture public.risk_delay_history;
begin
  first_capture := public.registrar_historico_atraso();
  if first_capture.data_referencia <> (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data fora do calendário de Brasília';
  end if;
  if first_capture.percentual_atraso is distinct from
    first_capture.exposicao_vencida / nullif(first_capture.exposicao_aberto, 0) then
    raise exception 'Fórmula incorreta';
  end if;
  -- Simula um valor anterior do mesmo dia. A próxima captura deve substituí-lo.
  update public.risk_delay_history set exposicao_vencida = 0, exposicao_aberto = 1
  where data_referencia = first_capture.data_referencia;
  second_capture := public.registrar_historico_atraso();
  if second_capture.exposicao_aberto <> first_capture.exposicao_aberto
    or second_capture.exposicao_vencida <> first_capture.exposicao_vencida
    or second_capture.calculado_em <= first_capture.calculado_em then
    raise exception 'Captura não substituiu o registro anterior';
  end if;
  if (select count(*) from public.risk_delay_history where data_referencia = first_capture.data_referencia) <> 1 then
    raise exception 'Mais de um registro no mesmo dia';
  end if;
  insert into public.risk_delay_history (data_referencia, exposicao_vencida, exposicao_aberto, titulos_aberto, titulos_vencidos)
  values ('1900-01-01', 0, 0, 0, 0);
  if (select percentual_atraso from public.risk_delay_history where data_referencia = '1900-01-01') is not null then
    raise exception 'Exposição zero deveria gerar percentual NULL';
  end if;
end;
$test$;
select set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'email', 'sem-acesso@example.invalid', 'role', 'authenticated')::text, true) is not null;
do $test$
begin
  if exists (select 1 from public.risk_delay_history) then raise exception 'RLS permitiu consulta não autorizada'; end if;
  begin
    perform public.registrar_historico_atraso();
    raise exception 'RPC permitiu usuário não autorizado';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;
do $test$
begin
  if has_table_privilege('anon', 'public.risk_delay_history', 'SELECT')
    or has_function_privilege('anon', 'public.registrar_historico_atraso()', 'EXECUTE') then
    raise exception 'Acesso anônimo indevido';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.risk_delay_history'::regclass) then
    raise exception 'RLS desabilitada';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.registrar_historico_atraso()'::regprocedure) then
    raise exception 'RPC não deveria contornar RLS';
  end if;
end;
$test$;
rollback;
select 'OK: cálculo, substituição diária, exposição zero e permissões verificados; dados do teste revertidos' as resultado;
