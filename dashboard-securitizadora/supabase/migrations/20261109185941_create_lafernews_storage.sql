insert into storage.buckets (id, name, public)
values ('lafernews', 'lafernews', false);

create policy "LaferNews requires dashboard access"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'lafernews'
  or (
    exists (select 1 from public.cedente_private_settings where id = 'visibility')
  )
);

create policy "LaferNews blocks anonymous reads"
on storage.objects as restrictive for select to anon
using (bucket_id <> 'lafernews');

create policy "Dashboard reads LaferNews"
on storage.objects for select to authenticated
using (bucket_id = 'lafernews');

create policy "LaferNews restricts client inserts"
on storage.objects as restrictive for insert to public
with check (bucket_id <> 'lafernews');

create policy "LaferNews restricts client updates"
on storage.objects as restrictive for update to public
using (bucket_id <> 'lafernews')
with check (bucket_id <> 'lafernews');

create policy "LaferNews restricts client deletes"
on storage.objects as restrictive for delete to public
using (bucket_id <> 'lafernews');

