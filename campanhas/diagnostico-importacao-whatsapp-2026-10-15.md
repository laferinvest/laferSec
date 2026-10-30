# Divergência entre GA4 e Google Ads — 15/10/2026

## Evidências conferidas nas interfaces

- Google Ads: Lafer Invest Securitizadora, cliente 379-893-6295.
- GA4: propriedade prop1, ID 512520438.
- Campanha: Leads-Search-3.
- Evento: lafer_whatsapp_open.
- Ação importada: WhatsApp — landing factoring, ID 7844861647.
- Relatório de eventos do GA4 em 14/10/2026: cinco eventos de abertura de WhatsApp, dois usuários.
- Ao separar por origem/mídia da sessão: quatro eventos diretos e um evento google / cpc.
- Ao separar por campanha da sessão: um evento atribuído à Leads-Search-3.
- Ao filtrar a Leads-Search-3 e separar por Hora: um evento na hora 12 do relatório do GA4.
- Histórico do Ads: ação ativada em 14/10 às 10:24:40; meta personalizada adicionada à campanha às 10:28:53; campanha ativada às 11:21:23. Horários do histórico em Brasília. A comparação exata entre plataformas depende também do fuso da propriedade do GA4.
- Ads em 15/10: zero em Todas as conversões no período de 11 a 15/10; status da ação “Não há conversões recentes”.
- No gerenciamento de conversões do GA4, a ação compartilha exatamente lafer_whatsapp_open com a conta 379-893-6295 e aponta ao mesmo ID 7844861647.
- Ação principal, contagem Uma, janela de clique 90 dias, atribuição baseada em dados, canais pagos do Google.
- Diagnóstico individual no Ads não apresentou um erro específico. Diagnóstico geral recomenda configurar a medição de conversões.

## Testes de coleta realizados em 15/10

Na landing publicada, com consentimento opcional aceito, um clique direto e uma abertura após o formulário chegaram ao GA4 em tempo real. O parâmetro contact_flow mostrou direct=1 e form=1. São dois testes do agente, não dois contatos de clientes. Nenhuma mensagem de WhatsApp foi enviada.

## Conclusão e limite

A coleta do evento e a divergência entre plataformas foram verificadas. A causa da não contabilização no Ads permanece sem identificação. Não há evidência suficiente para declarar a integração resolvida, atribuir o caso apenas ao prazo de processamento ou garantir recuperação retroativa. A interface não forneceu um erro de importação que permita uma correção específica.

Próxima análise necessária: verificar a elegibilidade/atribuição do evento e o processamento da ação importada no Google Ads, incluindo os sinais de consentimento desse contato. Se não houver um diagnóstico adicional acessível, encaminhar as evidências ao suporte do Google para análise do processamento. Nenhuma solicitação foi enviada ao suporte e nenhuma configuração persistente foi alterada nesta investigação.

## Encaminhamento ao suporte, autorizado pelo usuário em 15/10

Após autorização expressa, o diagnóstico foi encaminhado pelo atendimento oficial do Google Ads. A resposta automatizada inicial confundiu a plataforma Site com a origem Google Analytics (GA4); essa interpretação foi contestada no atendimento com os campos e IDs verificados. Foi solicitado atendimento humano.

O formulário por e-mail foi preenchido para a conta correta, com contato de retorno daanieel01@gmail.com e telefone fornecido pelo usuário para este chamado. Foi anexado evidencias-conversao-whatsapp-2026-10-15.zip, contendo o diagnóstico e as capturas sem cortes do relatório do GA4 e dos detalhes da ação no Ads. Foi solicitada análise da atribuição, elegibilidade e processamento, sem mudanças automáticas na conta. Não foi habilitada nova permissão de suporte na conta do Analytics, nem marcada a autorização opcional de conversão de teste.

A tela final confirmou: “Seu e-mail foi enviado” e “Encaminharemos sua mensagem à equipe certa.” Não exibiu número de protocolo ou prazo de resposta. Comprovante: confirmacao-suporte-google-ads-2026-10-15.jpg. O envio do chamado está concluído; a divergência de conversão permanece aguardando análise do suporte.
