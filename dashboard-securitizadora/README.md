# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is currently not compatible with SWC. See [this issue](https://github.com/vitejs/vite-plugin-react/issues/428) for tracking the progress.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Publicar uma execução do laferNews

Execute a partir da pasta do painel. O importador usa Python e PyYAML.

```powershell
python -m pip install PyYAML==6.0.2
python scripts/import-lafernews.py C:/laferInvest/laferNews outputs/lafernews-pacote
```

O importador seleciona o relatório datado mais recente e verifica se a triagem, as
memórias e as evidências correspondem à execução. Ele grava o pacote em
`outputs/lafernews-pacote`. Confira as contagens exibidas antes de publicar.

Com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` disponíveis apenas no ambiente do
terminal, publique no bucket privado criado pela migração do laferNews.

```powershell
node scripts/publish-lafernews.mjs outputs/lafernews-pacote
```

A publicação envia primeiro os originais e depois o manifesto. Uma nova tentativa
com o mesmo pacote é segura. Se o conteúdo mudar, use uma nova revisão. A aba do
painel lista os manifestos disponíveis para o usuário autenticado.
