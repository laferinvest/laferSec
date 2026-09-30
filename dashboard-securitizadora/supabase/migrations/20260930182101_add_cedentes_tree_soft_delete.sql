-- Preserve removed classifications while releasing their portfolio scope.
alter table public.arvore_cedentes add column excluida_em timestamptz;
grant update (excluida_em) on public.arvore_cedentes to authenticated;

alter table public.arvore_cedentes drop constraint arvore_cedentes_sem_sobreposicao;
alter table public.arvore_cedentes add constraint arvore_cedentes_sem_sobreposicao
exclude using gist (
  cedente_key extensions.gist_text_ops with =,
  (case
    when alcance = 'cedente' then public.arvore_cedentes_sacado_range(null, null, '()')
    else public.arvore_cedentes_sacado_range(sacado_key, sacado_key, '[]')
  end) with &&
) where (alcance <> 'pendente' and excluida_em is null);

comment on column public.arvore_cedentes.excluida_em is
  'Remocao logica da classificacao; nao remove cedentes, sacados ou titulos da carteira.';
