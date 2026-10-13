# Verificação da landing page do anúncio 1

Data: 13/10/2026.

## Verificado

- Landing original preservada sem diferenças no Git.
- Nova página, política de privacidade, CSS, JavaScript e fonte local com dependências locais existentes.
- 11 testes automatizados aprovados: consentimento recusado por padrão; finalidades independentes; persistência e expiração; revogação; armazenamento bloqueado; prévia sem medição; preparação e validação de solicitações; limites de texto do anúncio; IDs e destinos dos sitelinks; ausência de duplicação do GTM.
- Inspeção visual no navegador em larguras de 320, 390, 768 e 1440 pixels, além da largura normal da prévia. Nenhuma rolagem horizontal da página nas verificações de largura. A tabela comparativa tem rolagem interna em telas pequenas.
- Formulário verificado com MG/produtos e SP/serviços; edição das respostas e mensagem de orientação para cheques verificadas. Nenhuma mensagem foi enviada à empresa.
- Preferências de cookies verificadas no navegador: opções inicialmente desmarcadas; gravação da recusa; persistência ao abrir a política; alteração de estatísticas e revogação.
- Política acessível por link da landing; retorno à landing verificado.
- Nenhum erro ou aviso de console observado na página durante a verificação.
- Fonte Montserrat hospedada no projeto e imagem já existente reaproveitada. HTML principal, CSS, JS, fonte e imagem somam aproximadamente 143 KB sem compressão de transporte, fora favicon e medição opcional. Isso é tamanho de arquivos, não nota de desempenho.

## Limites desta verificação

- Nenhuma alteração publicada no domínio nem campanha ativada na conta Google Ads.
- A prévia local não dispara tags Google; a lógica foi testada com ambiente controlado. Validar a entrega real no domínio publicado com Tag Assistant e as configurações remotas de GA4/Ads.
- Não foi medido PageSpeed de produção, CrUX, Core Web Vitals de usuários reais, Índice de qualidade ou aprovação de políticas Google.
- A política precisa corresponder às práticas internas de conservação/compartilhamento. Esses processos internos não foram auditados.
- Conversão qualificada offline e atribuição ao atendimento ainda dependem de configuração na conta e no processo comercial.

## Registros visuais

- previews/landing-desktop.jpg
- previews/landing-completa.jpg
- previews/processo-desktop.jpg

## Repetir os testes

Na raiz do projeto: `node --test tests/factoring-ads.test.cjs`.

O pacote `lafer-factoring-anuncio-1.zip` contém somente os arquivos públicos necessários à nova página. Campanha, instruções e testes permanecem fora do pacote.
