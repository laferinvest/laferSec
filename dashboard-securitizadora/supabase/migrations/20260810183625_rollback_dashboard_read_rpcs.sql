-- Roll back the dashboard read RPC experiment while preserving all table data.
-- Keep the original migrations in history and restore the prior RLS expressions.

alter policy "Leitura restrita aos admins"
on public."secInfo"
using (
  (auth.jwt() ->> 'email') = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

alter policy "Modificação restrita aos admins"
on public."secInfo"
using (
  (auth.jwt() ->> 'email') = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

alter policy "secInfo_delete_admin_only"
on public."secInfo"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_insert_admin_only"
on public."secInfo"
with check (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_select_admin_only"
on public."secInfo"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_update_admin_only"
on public."secInfo"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid)
with check (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "Leitura restrita aos admins"
on public."secInfoSmart"
using (
  (auth.jwt() ->> 'email') = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

alter policy "Modificação restrita aos admins"
on public."secInfoSmart"
using (
  (auth.jwt() ->> 'email') = any (
    array[
      'daniel@adm.com.br',
      'kesia@adm.com.br',
      'eliene@adm.com.br',
      'laerte@adm.com.br'
    ]
  )
);

alter policy "secInfo_delete_admin_only"
on public."secInfoSmart"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_insert_admin_only"
on public."secInfoSmart"
with check (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_select_admin_only"
on public."secInfoSmart"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_update_admin_only"
on public."secInfoSmart"
using (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid)
with check (auth.uid() = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

-- Drop API-facing functions before the private helpers they call.
drop function if exists public.dashboard_resumo_matinal_rows(date, date);
drop function if exists public.dashboard_macro_rows(date);
drop function if exists public.dashboard_micro_relationships(text[]);
drop function if exists public.dashboard_micro_rows(
  text[], text[], text[], text[], text, date, date, text, text, date, integer, boolean
);
drop function if exists public.dashboard_micro_evolution(
  text[], text[], text[], text[], text, text, date
);

drop function if exists public.dashboard_typed_rows();
drop function if exists public.dashboard_base_rows();
drop function if exists public.dashboard_public_row(jsonb, text);
drop function if exists public.dashboard_is_valid_row(text, text, text);
drop function if exists public.dashboard_row_status(date, date, text, text, date, boolean);
drop function if exists public.dashboard_add_business_days(date, integer);
drop function if exists public.dashboard_next_weekday(date);
drop function if exists public.dashboard_try_numeric(text);
drop function if exists public.dashboard_try_date(text);
drop function if exists public.dashboard_normalize_text(text);
