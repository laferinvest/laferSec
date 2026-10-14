# Configuração concluída — Leads-Search-3

Data: 14/10/2026. Alterações feitas a pedido do usuário, após a auditoria inicial.

- GA4: propriedade prop1 (512520438), evento lafer_whatsapp_open marcado como principal. Estado da estrela confirmado após gravação.
- Google Ads: ação WhatsApp — landing factoring criada com origem Site (Google Analytics (GA4)), baseada em lafer_whatsapp_open da prop1.
- Categoria: Contato. Otimização: Principal. Contagem: Uma. Janela de clique: 90 dias. Atribuição: baseada em dados. Sem valor monetário fictício para a abertura do WhatsApp.
- Meta personalizada WhatsApp da landing criada contendo somente a nova ação. Os eventos antigos e Conversation started não foram adicionados a essa meta.
- Leads-Search-3: metas específicas da campanha, somente WhatsApp da landing. A seleção anterior de Leads de mensagens foi substituída.
- Campanha permaneceu pausada. Orçamento R$ 50/dia e CPA desejado R$ 20 preservados.
- Não houve nova publicação do site: o usuário informou que já havia publicado.

## Verificação

A configuração da campanha exibiu, após salvar, "Específicas da campanha: WhatsApp da landing". A lista de ações confirmou "Principal", "Uma" e origem GA4 para WhatsApp — landing factoring.

A ação recém-criada mostrava "Não há conversões recentes" e zero conversões. Isso não confirma ainda uma conversão atribuída após clique em anúncio. Continua necessário verificar os primeiros resultados reais; abertura do WhatsApp não comprova envio da mensagem, qualificação ou contratação.

A ação é principal na categoria Contato da conta. Campanhas que utilizam essa categoria padrão podem também passar a considerar a nova ação; a configuração específica da Leads-Search-3 contém apenas a nova ação. Nenhuma configuração da campanha antiga foi editada.

Referência curta, associação ao clique e importação de cedentes qualificados são etapas distintas. A referência já está no código da landing; a integração de atribuição e qualificação offline continua pendente.

## Registros visuais

Correção local posterior, em 14/10/2026: a landing deixou de descartar os identificadores de anúncios da URL enviada à medição quando há consentimento para anúncios. Parâmetros UTM e o sinal de depuração também são preservados conforme o consentimento para estatísticas. A alteração foi feita no código e exige nova publicação do pacote do site; não altera a ação de conversão nem ativa a campanha. Essa preservação não cria associação no CRM nem comprova atribuição de uma conversão real.

- previews/ga4-whatsapp-evento-principal.jpg
- previews/ads-whatsapp-conversao-criada.jpg
- previews/leads-search-3-meta-whatsapp.jpg
