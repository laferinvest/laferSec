# Landing — Securitizadora e desconto de recebíveis

Preparada em 16/10/2026 no repositório do site. Nova página, sem substituir as landings existentes.

- Arquivo: enterprise-securitizadora-ads.html
- URL após publicação: https://www.lafersec.com.br/enterprise-securitizadora-ads.html
- Estilo adicional: css/securitizadora-ads.css
- Buscas atendidas: securitizadora para empresas, desconto de recebíveis, desconto de duplicatas e desconto/antecipação de boletos comerciais a receber.
- Perfil: empresas B2B de MG/SP com faturamento desde R$ 200 mil/mês. Duplicatas de produtos e serviços. Sem mínimo por operação. Sem cheques ou recebíveis de cartão.

## Decisão de conteúdo

A landing de factoring atende à mesma operação, mas seu primeiro título e a comparação de modalidades respondem a outra busca. A nova página apresenta a Lafer como securitizadora desde o início e explica desconto de boleto vinculado a vendas/serviços já realizados. Não anuncia desconto em boletos a pagar, qualquer tipo de recebível, crédito para pessoa física ou compra de títulos de investimento.

A composição usa as mesmas cores, fonte local e contatos, com outra imagem do site, primeira dobra própria, explicação do boleto, lista de recebíveis, critérios, etapas, custos e dados da empresa. Sem perguntas frequentes, depoimentos ou estatísticas inventados. A ausência de cobrança de IOF é descrita somente para as operações da Lafer; não há promessa de menor taxa em qualquer operação.

## Atendimento e conversão

O formulário usa os mesmos critérios e faixas de faturamento da landing de factoring. Prepara uma mensagem localmente; o visitante confirma o envio no WhatsApp. O contato direto ao lado do formulário foi mantido com a mensagem padrão atual e a referência curta. Telefone: (35) 9 9773-5926. E-mail comercial: adm@lafersec.com.br.

Reutiliza js/factoring-ads.js, a escolha de cookies e o evento lafer_whatsapp_open. Configuração de atribuição preservada conforme o consentimento. A preparação do formulário não se torna conversão primária. A URL do evento identifica esta landing em page_location; não é necessário criar outra ação de conversão apenas por existir uma segunda página. A ação que importa esse evento pode continuar medindo as duas páginas, mesmo se seu nome mencionar factoring. Não foi feita nova conferência da configuração da conta nesta etapa.

A página de privacidade compartilhada passa a mencionar expressamente as duas landings. Esta preparação não modifica metas, campanha, orçamento ou anúncios no Google Ads e não cria integração de qualificação offline.

## Destinos para recursos do grupo

- Recebíveis: #recebiveis-aceitos
- Desconto de boleto: #desconto-de-boleto
- Quem pode antecipar: #quem-pode-antecipar
- Etapas: #como-funciona
- Condições: #taxas-e-condicoes
- Empresa: #sobre-a-lafer
- Proposta: #solicitar-proposta

Sufixo sugerido no novo grupo, preservando a marcação automática:
utm_source=google&utm_medium=cpc&utm_campaign=securitizadora_b2b_mg_sp&utm_content={creative}&utm_term={keyword}

As palavras-chave genéricas de desconto de boleto podem atrair buscas por contas a pagar. A página explicita recebíveis B2B; revisar os termos reais antes de expandir a segmentação. A taxa de conversão deve ser avaliada por contatos comerciais, junto à relevância e ao custo. Não há promessa de Índice de Qualidade 10.

## Publicação

Pacote: lafer-landing-securitizadora.zip. Preservar a estrutura de pastas. Inclui as duas landings e seus recursos públicos para que os links da política continuem funcionando. Publicar no domínio existente; a URL acima só estará disponível depois dessa etapa. A página enterprise-securitizadora.html já existente é uma versão legada e foi preservada.

## Validação local

Os 33 testes de tests/factoring-ads.test.cjs passaram, incluindo os campos reais da nova página, mensagem do WhatsApp, consentimento, referência curta, atribuição pela URL e distinção entre preparar a solicitação e abrir o atendimento. São verificações locais; não comprovam recebimento no GA4 ou atribuição de conversão no Google Ads após a publicação.

A prévia local respondeu por HTTP, mas a ferramenta do navegador não inicializou. A conferência visual em navegador e em telas menores permanece pendente; as regras responsivas estão no CSS.

## Fontes de apoio

- https://support.google.com/google-ads/answer/6238826?hl=pt-BR
- https://support.google.com/google-ads/answer/12732144?hl=pt-BR
- https://www.bcb.gov.br/estabilidadefinanceira/duplicatas-escriturais
