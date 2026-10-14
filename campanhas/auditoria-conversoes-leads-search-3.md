# Auditoria de conversões — Leads-Search-3

Verificação em 14/10/2026. Inspeção do Google Ads e Google Analytics autenticados, JavaScript publicado e arquivos locais.

## Resultado

A landing coleta eventos no Analytics, mas a Leads-Search-3 não está conectada à conversão de contato da nova landing. A campanha está pausada e o próprio diagnóstico do Google Ads informa acompanhamento de conversões incompleto.

### Campanha e conta

- Campanha: Leads-Search-3, Pesquisa, pausada.
- Meta selecionada: padrão da conta — Leads de mensagens.
- Ação principal dessa meta: Conversation started, origem Hospedado pelo Google, contagem Uma, janela de clique de 30 dias. Essa ação não corresponde ao evento de WhatsApp da landing.
- Estratégia observada: CPA desejado de R$ 20; orçamento R$ 50/dia. Valores apenas lidos.
- Existe a conversão prop1 (web) click_whatsapp, importada do GA4: evento click_whatsapp, categoria Contatos, Principal, contagem Todas, janela de clique de 90 dias. Não está incluída nas metas padrão da conta.
- A lista de ações ativadas contém três ações: Conversation started, click_whatsapp e Android installs (all other apps). Nenhuma ação importada de lafer_whatsapp_open foi encontrada.
- Codificação automática da conta: Sim.
- Vinculação GA4/Google Ads: concluída para Lafer Invest Securitizadora. Personalização de publicidade desativada nessa vinculação.

### Analytics

- Propriedade: prop1, ID 512520438; fluxo Web Lafer, domínio https://www.lafersec.com.br; ID de medição G-3Q66N7J22G. Corresponde ao código da landing.
- Fluxo confirma coleta ativa nas últimas 48 horas.
- Eventos recentes incluem lafer_cta_click, lafer_proposal_prepared e lafer_whatsapp_open. Isso confirma recebimento prévio dos eventos, sem garantir que cada clique deste teste tenha sido recebido em tempo real.
- Eventos principais: click_whatsapp e purchase. lafer_whatsapp_open não está marcado como principal.
- Não existem eventos personalizados derivados nem modificações de eventos nesse fluxo que convertam lafer_whatsapp_open em click_whatsapp.
- Medição aprimorada ativada, incluindo cliques de saída e interações com formulário. Esses eventos automáticos são diagnósticos adicionais; não devem ser somados ao evento específico de WhatsApp como se fossem contatos diferentes.
- Rolagem, tempo e preparação da mensagem não comprovam contato. leitor_qualificado_60s aparece como evento comum, sem estrela de evento principal.

## Gatilhos da landing

| Ação do visitante | Evento | Verificação |
|---|---|---|
| Botões que levam à solicitação | lafer_cta_click | Seis links do HTML com destino correto; disparo testado |
| Preparar formulário válido | lafer_proposal_prepared | Handler testado; nenhuma abertura de WhatsApp nessa etapa |
| Preparar formulário incompleto | Nenhum evento de proposta/contato | Testado |
| WhatsApp direto na seção A Lafer | lafer_whatsapp_open, placement=about | Handler e link testados |
| WhatsApp direto em Prefere falar diretamente | lafer_whatsapp_open, placement=proposal | Handler, classificação e destino testados |
| WhatsApp após preparar formulário | lafer_whatsapp_open, placement=proposal | Handler testado; correção local de navegação implementada |
| Telefones na seção A Lafer e rodapé | lafer_phone_open | Handler e classificação dos links testados; não comprova ligação completada |
| E-mails na seção A Lafer e rodapé | lafer_email_open | Handler e classificação dos links testados; não comprova envio de e-mail |

Nenhum evento confirma envio da mensagem pelo WhatsApp, conversa respondida, cedente qualificado ou operação fechada.

## Correções feitas nos arquivos locais

- Abertura do WhatsApp após formulário aguarda o processamento do evento, com limite de 800 ms. Se a tag estiver bloqueada, o atendimento abre pelo temporizador de segurança.
- Clique duplo enquanto a navegação está pendente não duplica o evento nem a abertura.
- Contatos incluem contact_flow=direct ou contact_flow=form, permitindo separar os dois caminhos sem transmitir respostas do formulário.
- Sem consentimento para estatísticas, e na prévia local, WhatsApp abre imediatamente e esses eventos não são enviados ao GA4. A finalidade de anúncios, isoladamente, não autoriza Analytics.
- Pacote lafer-factoring-anuncio-1.zip atualizado com o JavaScript corrigido.
- 18 testes passaram, incluindo consentimento, revogação, eventos dos botões, formulário, navegação com callback, bloqueio da tag, clique duplo e classificação dos links reais.

A cópia pública de js/factoring-ads.js consultada durante a auditoria ainda continha a navegação imediata anterior. Publicar o pacote atualizado e verificar o envio no domínio real com Tag Assistant antes de considerar a correção em produção.

## Ajustes necessários na conta

1. Marcar lafer_whatsapp_open como evento principal no GA4 e criar/importar uma única ação no Google Ads baseada nele. Manter click_whatsapp separado para o histórico das páginas antigas; não disparar os dois nomes para o mesmo clique.
2. Para observar contatos da landing, usar a nova ação com contagem Uma. Definir expressamente se será secundária para observação ou principal provisória para otimizar intenção de contato. Clique não é cedente confirmado.
3. Se a campanha deve otimizar contatos da landing, selecionar a meta/ação correspondente especificamente na Leads-Search-3. A seleção atual de Conversation started não resolve essa integração.
4. Manter lafer_cta_click e lafer_proposal_prepared como diagnóstico, sem ambos virarem conversões principais. Não importar click, form_start, form_submit, scroll ou timer como contatos.
5. Registrar placement e contact_flow como dimensões personalizadas de evento, caso seja necessário comparar os caminhos nos relatórios padrão.
6. Testar atribuição e a conversão importada após a configuração. Para medir cedentes reais, integrar a confirmação do atendimento/CRM e a atribuição ao anúncio; esse estágio ainda não existe na implementação da landing.

Nenhuma configuração da campanha, ação de conversão ou propriedade foi alterada durante esta auditoria. Não houve envio de mensagem à empresa nem importação de um contato fictício.

## Referências

- [Google: criar conversões com base nos eventos principais do Analytics](https://support.google.com/google-ads/answer/10632359)
- [Google: contagem de conversões para leads](https://support.google.com/google-ads/answer/3438531)
- [Google: ações principais e secundárias](https://support.google.com/google-ads/answer/11461796)
- [Google: parâmetros event_callback e event_timeout](https://developers.google.com/tag-platform/gtagjs/reference/parameters)
- [Google: medição aprimorada](https://support.google.com/analytics/answer/9216061)
