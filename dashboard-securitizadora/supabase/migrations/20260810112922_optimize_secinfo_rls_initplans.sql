-- Evaluate Supabase auth helpers once per statement instead of once per row.
-- Policy names, roles, commands, users and access semantics remain unchanged.

alter policy "Leitura restrita aos admins"
on public."secInfo"
using (
  ((select auth.jwt()) ->> 'email') = any (
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
  ((select auth.jwt()) ->> 'email') = any (
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
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_insert_admin_only"
on public."secInfo"
with check ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_select_admin_only"
on public."secInfo"
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_update_admin_only"
on public."secInfo"
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid)
with check ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "Leitura restrita aos admins"
on public."secInfoSmart"
using (
  ((select auth.jwt()) ->> 'email') = any (
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
  ((select auth.jwt()) ->> 'email') = any (
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
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_insert_admin_only"
on public."secInfoSmart"
with check ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_select_admin_only"
on public."secInfoSmart"
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);

alter policy "secInfo_update_admin_only"
on public."secInfoSmart"
using ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid)
with check ((select auth.uid()) = '6d68abd7-045d-4e4a-810f-1fc231c823dc'::uuid);
