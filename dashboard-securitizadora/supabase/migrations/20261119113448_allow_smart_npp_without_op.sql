-- The importer accepts only NPP without an OP. Match its normalized identity
-- here as well so concurrent imports cannot insert the same title twice.
create unique index if not exists secinfo_smart_sem_op_identity_key
on public."secInfoSmart" (
  (regexp_replace(
    regexp_replace(
      regexp_replace(lower(normalize(btrim("Cliente"), NFD)), '[̀-ͯ]', '', 'g'),
      '(?:^|[\s-]+)(sacado|cedente)\s*$', ''
    ), '[^a-z0-9]', '', 'g'
  )),
  (regexp_replace(
    regexp_replace(
      regexp_replace(lower(normalize(btrim("Sacado"), NFD)), '[̀-ͯ]', '', 'g'),
      '(?:^|[\s-]+)(sacado|cedente)\s*$', ''
    ), '[^a-z0-9]', '', 'g'
  )),
  (regexp_replace(btrim("Dcto"), '\.0$', '')),
  "Vcto"
)
where "Borderô" is null;
