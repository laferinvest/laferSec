-- One current title row; historical repurchases never mark its balance as paid.
ALTER TABLE public."secInfoSmart"
  ADD COLUMN IF NOT EXISTS recompra_parcial jsonb;

COMMENT ON COLUMN public."secInfoSmart".recompra_parcial IS
  'Original title snapshot and reconciled partial repurchase events. Entrada, Status and Pgto describe only the current balance.';
