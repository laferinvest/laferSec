# Contexto para criar o HTML da árvore de cedentes

Arquivo único de transferência para outro projeto • consolidado em 28/09/2026

Este arquivo reúne o objetivo, as correções feitas durante a conversa, o catálogo de rótulos e as regras de funcionamento. Ele é autossuficiente para iniciar o trabalho em outro projeto. Não é necessário acessar o chat anterior nem os arquivos citados como origem.

## Pedido para iniciar o novo chat

> Leia este arquivo e crie neste projeto um HTML com uma árvore visual para classificar os cedentes da minha securitizadora por exposição econômica. Use o catálogo de rótulos prontos deste documento. Quero enxergar o tronco, as ramificações e os caminhos de classificação. Separe os rótulos dos indicadores econômicos e das explicações. Comece pela representação visual funcional, respeitando a estrutura do projeto, e use apenas exemplos explicitamente fictícios enquanto eu não fornecer os dados reais.

## 1. O problema que o usuário quer resolver

O usuário trabalha com cedentes de uma securitizadora e quer entender quais empresas e recebíveis ficam expostos quando um setor, ciclo ou fator econômico melhora ou piora. Também quer identificar concentração econômica escondida entre cedentes de CNAEs diferentes.

Exemplo: um fornecedor de peças metálicas, um fabricante de componentes plásticos e um prestador de transporte podem depender da mesma cadeia automotiva. Diversificação por atividade do cedente não demonstra diversificação do destino econômico.

A análise parte de uma apresentação chamada `Economia_industrial_2027.pptx`, sobre demanda, investimento, produção industrial, margem e caixa. O conteúdo necessário para este projeto foi consolidado aqui.

O usuário quer uma árvore que comece com categorias amplas e avance para características específicas. O resultado precisa permitir atribuir classificações a clientes, e não apenas explicar macroeconomia.

## 2. O esclarecimento mais importante da conversa

O usuário pediu **rótulos já prontos para atribuir aos clientes**.

Uma resposta anterior colocou na ponta do desenho a frase “Investimento e financiamento — FBCF e produção de bens de capital”. O usuário não entendeu a origem e a finalidade dessa frase. Ela misturava mecanismo econômico e indicadores, sem funcionar como categoria de cadastro.

A correção foi separar:

| Camada | O que contém | Exemplo |
|---|---|---|
| Classificação | Opções fechadas e selecionáveis | Alimentos e bebidas / CAPEX de expansão / Equipamento completo |
| Fatores de exposição | Atributos padronizados ligados à classificação | Investimento do comprador; Crédito do comprador |
| Indicadores | Séries ou sinais usados para acompanhamento | FBCF; PIM de bens de capital pertinente; pedidos do fabricante |
| Explicações | Ajuda sobre quando selecionar cada opção | Texto curto fora do nome do nó |

**Os nomes dos nós devem ser os rótulos do catálogo.** Não substituir os rótulos por frases analíticas. FBCF e PIM não são nomes de setores nem finalidades da compra.

## 3. Decisões de conteúdo para preservar

- O destino econômico da venda é o eixo principal. O CNAE do cedente fica como informação complementar.
- A árvore usa opções previamente definidas, com códigos estáveis.
- O cedente pode ocupar vários caminhos. A unidade detalhada é uma parcela identificável de cedente × sacado × produto/aplicação × destino, ou de títulos quando houver dados.
- Classificar até o último nível comprovado. Desconhecido não significa baixo risco nem exposição zero.
- CAPEX descreve o investimento do comprador/usuário que gera a receita do cedente. Não é necessariamente o investimento feito pelo próprio cedente.
- Uma peça que é insumo no fabricante de máquinas pode depender, economicamente, do investimento do usuário da máquina. Registrar uso imediato e motor econômico a jusante separadamente.
- Compra de máquina nova não comprova expansão: pode substituir um ativo, melhorar eficiência ou atender a uma exigência.
- Essencialidade e durabilidade são campos separados. Um produto pode ser durável e essencial. Um serviço operacional pode ser necessário ou adiável.
- Demanda recorrente não garante margem, caixa ou pagamento. Evitar rótulos automáticos de “bom cedente” ou “baixo risco”.
- O usuário vê os títulos cedidos, não necessariamente todas as notas ou o faturamento completo de cada empresa. Não inferir o negócio inteiro a partir da carteira financiada.
- Identificar quem deve o título e de quem esse devedor depende para receber. O usuário relatou uma perda em uma cadeia de confecção/marca esportiva/clubes; a existência de intermediário não elimina a dependência econômica dos pagamentos posteriores.

O catálogo abaixo foi proposto pelo assistente para atender a esses requisitos. Ele ainda não foi validado com uma base real de clientes e não é uma classificação oficial do IBGE nem um modelo calibrado de inadimplência.

## 4. Hierarquia da árvore

```text
CARTEIRA
└─ Família econômica de destino
   └─ Setor de destino
      └─ Finalidade econômica
         ├─ Se CAPEX: motivo do CAPEX
         │  └─ Aplicação do produto
         └─ Nas demais finalidades: aplicação do produto
            └─ Cedentes/parcelas classificados nesse caminho
```

Na apresentação visual, é possível mostrar diretamente “CAPEX de expansão” como rótulo combinado de finalidade e motivo, sem obrigar a exibir dois nós redundantes. Os dados devem preservar a separação dos campos.

Canal de venda, mercado geográfico, essencialidade, repasse, qualidade da informação e fatores de exposição são atributos associados às folhas. Eles não precisam multiplicar os ramos nem gerar todas as combinações possíveis.

Exemplos de caminhos preenchidos:

```text
Consumo e serviços às pessoas
└─ Alimentos e bebidas
   ├─ CAPEX de expansão
   │  └─ Equipamento completo
   ├─ Insumo da produção corrente
   │  └─ Embalagem
   └─ Manutenção e reposição rotineiras
      └─ Peça de reposição rotineira
```

### Regras de fronteira entre destinos

- Máquina, embalagem ou manutenção destinadas a uma fábrica de alimentos: Alimentos e bebidas, com finalidades/aplicações distintas.
- Estrutura para uma usina elétrica: Energia elétrica, com aplicação Obra ou estrutura.
- Edificação fabril cujo setor usuário não está identificado: Construção industrial e logística. Atualizar o destino se o usuário econômico for identificado.
- Componente de colheitadeira: cadeia agrícola comprovada, mesmo se o sacado for fabricante de equipamento.
- Exportação de móveis: Bens para o lar, com atributo de mercado externo.
- Compra pública de medicamentos: Saúde e cuidado, com atributo de pagador público.
- Material básico sem destino posterior aberto pode permanecer na cadeia de base conhecida. Não inventar o uso final.
- Não registrar uma mesma parcela simultaneamente em dois destinos exclusivos. Se há destinos diferentes comprovados, dividir em parcelas.

## 5. Escopo do HTML no outro projeto

**Pedido confirmado:** criar uma representação visual em HTML da árvore, com rótulos prontos para classificar os cedentes, em outro projeto.

**Ponto de partida sugerido para a implementação:**

1. Mostrar uma árvore com conexões visíveis entre tronco, ramos e folhas. O usuário já recebeu listas e diagramas resumidos; a próxima implementação deve tornar a hierarquia evidente.
2. Exibir as famílias econômicas e permitir expandir setores e finalidades, mantendo o caminho escolhido compreensível.
3. Usar o catálogo fechado como fonte dos nomes e valores selecionáveis.
4. Ao selecionar uma folha, mostrar seu caminho completo e uma área separada para atributos, explicação curta e indicadores associados.
5. Tratar o CAPEX de forma condicional: o campo motivo só aparece para FIN-K.
6. Usar português brasileiro, textos legíveis, navegação por teclado e desenho responsivo. Zoom e deslocamento podem ajudar se a árvore ficar grande; não reduzir tudo a texto minúsculo.
7. Usar demonstração fictícia claramente identificada se forem necessários clientes para demonstrar o funcionamento. Não preencher a carteira real com exemplos inventados.

Ainda não foram definidos pelo usuário: framework, identidade visual, banco de dados, autenticação, importação de planilhas, integração com sistemas, hospedagem ou publicação. Formulário de clientes, persistência e cálculo de concentração são evoluções possíveis, não pedidos adicionais já fechados. A linguagem visual também pode ser refinada no novo projeto.

Antes de implementar, examinar a estrutura e as instruções do projeto de destino. Se ele já tiver uma aplicação, adaptar a solução a ela. Se estiver vazio, um HTML autônomo com estilos, lógica e dados do catálogo é um ponto de partida simples. A versão anterior da visualização não precisa ser copiada e não constitui requisito de design.

## 6. Catálogo fechado para implementação

Este é o catálogo atualizado. Os códigos têm prefixos distintos para evitar confundir setor, finalidade, motivo, aplicação e fator. Descrições são ajuda de preenchimento, não novos rótulos. Manter um campo de versão do catálogo.

### 6.1. Setor de destino

Selecionar uma opção para cada parcela. A família é automática. O destino é a cadeia que utiliza o produto, até onde houver evidência; o CNAE do cedente permanece em campo próprio.

| Código | Rótulo exibido | Família automática |
|---|---|---|
| SET-A1 | Alimentos e bebidas | Consumo e serviços às pessoas |
| SET-A2 | Saúde e cuidado | Consumo e serviços às pessoas |
| SET-A3 | Bem-estar e beleza | Consumo e serviços às pessoas |
| SET-A4 | Vestuário, calçados e esporte | Consumo e serviços às pessoas |
| SET-A5 | Bens para o lar | Consumo e serviços às pessoas |
| SET-A6 | Educação, turismo e lazer | Consumo e serviços às pessoas |
| SET-B1 | Construção residencial | Construção e mercado imobiliário |
| SET-B2 | Construção comercial e institucional | Construção e mercado imobiliário |
| SET-B3 | Construção industrial e logística | Construção e mercado imobiliário |
| SET-C1 | Lavouras temporárias | Agropecuária e florestas |
| SET-C2 | Lavouras permanentes | Agropecuária e florestas |
| SET-C3 | Pecuária | Agropecuária e florestas |
| SET-C4 | Silvicultura | Agropecuária e florestas |
| SET-D1 | Mineração | Recursos naturais e indústria de base |
| SET-D2 | Petróleo, gás e refino | Recursos naturais e indústria de base |
| SET-D3 | Siderurgia e metais | Recursos naturais e indústria de base |
| SET-D4 | Química de base e fertilizantes | Recursos naturais e indústria de base |
| SET-D5 | Celulose, papel e materiais de base | Recursos naturais e indústria de base |
| SET-E1 | Energia elétrica | Infraestrutura e utilidades |
| SET-E2 | Água, esgoto e resíduos | Infraestrutura e utilidades |
| SET-E3 | Redes de telecomunicações | Infraestrutura e utilidades |
| SET-E4 | Infraestrutura de transporte | Infraestrutura e utilidades |
| SET-F1 | Automóveis e veículos leves | Mobilidade e logística |
| SET-F2 | Veículos produtivos | Mobilidade e logística |
| SET-F3 | Transporte de cargas e armazenagem | Mobilidade e logística |
| SET-F4 | Transporte de passageiros | Mobilidade e logística |
| SET-G1 | Software, dados e TI | Tecnologia e serviços às empresas |
| SET-G2 | Serviços profissionais e terceirização | Tecnologia e serviços às empresas |
| SET-G3 | Operação industrial com destino posterior não aberto | Tecnologia e serviços às empresas |
| SET-Z1 | Destino não identificado | Destino não identificado |

As regras de fronteira descritas na seção 4 deste briefing continuam válidas. Por exemplo, máquina para fábrica de alimentos vai para SET-A1; estrutura para usina elétrica vai para SET-E1. Uma edificação fabril sem setor usuário identificado pode ficar em SET-B3. Ao descobrir o usuário, atualizar o destino, mantendo construção como aplicação.

### 6.2. Finalidade econômica e seus rótulos finais

Selecionar uma finalidade por parcela. O nome da finalidade é fixo, inclusive quando a evidência for insuficiente.

| Código | Rótulo exibido | Regra de seleção |
|---|---|---|
| FIN-K | Investimento em ativos — CAPEX | A venda está vinculada à aquisição, construção ou intervenção capitalizável em um ativo do usuário conhecido |
| FIN-I | Insumo da produção corrente | O item é incorporado ao produto ou consumido para produzir; não há vínculo comprovado com um investimento final que prevaleça na classificação |
| FIN-M | Manutenção e reposição rotineiras | A compra mantém equipamentos ou instalações em funcionamento por reparo, desgaste ou manutenção periódica |
| FIN-S | Serviço operacional | A venda sustenta uma atividade corrente do comprador, como frete ou suporte |
| FIN-C | Consumo final | A cadeia termina no consumo do bem ou serviço pelo usuário final; pode haver varejo ou distribuidor intermediário |
| FIN-U | Finalidade não identificada | Ainda não há evidência suficiente para uma das opções anteriores |

Somente FIN-K abre o campo **motivo do CAPEX**:

| Código | Rótulo exibido | Regra de seleção |
|---|---|---|
| CAP-EXP | CAPEX de expansão | Aumento de capacidade, nova instalação ou ativo adicional |
| CAP-PRE | CAPEX de preservação | Substituição ou intervenção relevante para preservar a capacidade existente |
| CAP-EFI | CAPEX de eficiência | Modernização para produtividade, redução de custos ou melhoria de desempenho |
| CAP-ADE | CAPEX de adequação | Atendimento a requisito técnico, de segurança ou ambiental |
| CAP-MUL | CAPEX com múltiplas finalidades | Mais de um motivo está comprovado, sem abertura que permita separar parcelas |
| CAP-NI | CAPEX com finalidade não identificada | O investimento é conhecido, mas o motivo específico não foi comprovado |

No painel, FIN-K + CAP-EXP aparece como **CAPEX de expansão**. Não é necessário exibir dois rótulos repetitivos ao usuário. As demais finalidades aparecem diretamente com seus nomes.

Exemplo de vínculo indireto: peça para uma máquina nova vendida a um fabricante de equipamentos. O uso imediato é componente industrial. Se estiver comprovado que a máquina atende à expansão de uma fábrica de alimentos, a classificação econômica será SET-A1 + FIN-K + CAP-EXP. Se só estiver comprovado o investimento, usar CAP-NI. Não presumir expansão porque a máquina é nova.

O enquadramento econômico de manutenção deve seguir o uso comprovado. Quando a distinção contábil entre intervenção capitalizável e manutenção corrente for material e não estiver esclarecida, manter a finalidade pendente e registrar a aplicação já conhecida.

### 6.3. Aplicação do produto ou serviço

Selecionar uma opção por parcela. Quando a venda misturar aplicações sem abertura, selecionar APL-MUL.

| Código | Rótulo exibido |
|---|---|
| APL-OBR | Obra ou estrutura |
| APL-EQP | Equipamento completo |
| APL-COM | Componente de equipamento novo |
| APL-SUB | Grande componente de substituição |
| APL-REP | Peça de reposição rotineira |
| APL-EMB | Embalagem |
| APL-MAT | Matéria-prima |
| APL-CON | Consumível de produção |
| APL-PRO | Produto final |
| APL-SER | Serviço |
| APL-SOF | Software ou outro ativo intelectual |
| APL-BIO | Ativo biológico cultivado |
| APL-MUL | Múltiplas aplicações sem abertura |
| APL-OUT | Outra aplicação comprovada |
| APL-NI | Aplicação não identificada |

APL-OUT exige descrição complementar e revisão do catálogo. A descrição não cria automaticamente um novo rótulo.

### 6.4. Canal da venda

Selecionar uma opção por parcela, conforme o comprador imediato. A natureza pública/privada do pagador é outro atributo.

| Código | Rótulo exibido |
|---|---|
| CAN-USU | Venda ao usuário |
| CAN-EQP | Venda a fabricante de equipamento |
| CAN-IND | Venda a outro fabricante |
| CAN-DIS | Venda a distribuidor |
| CAN-VAR | Venda a varejista |
| CAN-INT | Venda a integrador ou empreiteiro |
| CAN-OUT | Outro canal comprovado |
| CAN-NI | Canal não identificado |

Preferir CAN-EQP ou CAN-IND quando o comprador incorpora o item à fabricação de um produto para terceiros. CAN-USU se aplica quando ele usa o item em sua própria atividade ou consumo. CAN-INT se aplica quando integra o fornecimento em projeto de terceiro. Não inferir o usuário final apenas pelo canal.

### 6.5. Mercado geográfico

| Código | Rótulo exibido | Critério |
|---|---|---|
| MER-BR | Mercado interno | Uso final comprovado no Brasil |
| MER-ED | Exportação direta | O cedente exporta a parcela analisada |
| MER-EI | Exportação indireta | A venda doméstica está comprovadamente ligada ao produto exportado por outro elo |
| MER-MX | Mercado misto sem abertura | Há destinos internos e externos comprovados, sem divisão disponível |
| MER-NI | Mercado não identificado | Destino geográfico final não comprovado |

### 6.6. Atributos adicionais com opções fechadas

Os atributos a seguir enriquecem os ramos, sem multiplicar os valores da carteira. Ausência de evidência recebe “não identificado”.

| Campo | Opções permitidas | Regra |
|---|---|---|
| Essencialidade da compra | Essencial / Adiável / Mista sem abertura / Não identificada | Registrar a consequência de adiar a compra; não inferir só pelo setor |
| Durabilidade do bem de consumo | Durável / Semidurável / Não durável / Não aplicável / Não identificada | Aplicar ao produto efetivo; essa dimensão é independente de essencialidade |
| Repasse de preços | Contratual / Negociado / Preço fixo no contrato / Misto sem abertura / Não identificado | Basear no contrato e na prática observada |
| Natureza do pagador | Empresa privada / Ente público / Entidade sem fins lucrativos / Pessoa física / Não identificada | Identificar a parte que deve o título |
| Estado do estoque do canal | Reposição normal / Formação de estoque / Redução de estoque / Não identificado | Exige informação sobre o canal, não apenas aumento/queda da venda do cedente |
| Qualidade da classificação | Documentada / Declarada / Inferida / Não identificada | Registrar fonte, data e responsável |

“Consumo durável” e “consumo essencial” não devem disputar a mesma opção: um bem pode ser durável e essencial. Da mesma forma, um serviço operacional pode ser necessário ou adiável. Por isso, essas características ficam em campos separados nesta versão.

### 6.7. Rótulos de fatores de exposição

Este campo aceita várias opções. Selecionar apenas fatores com vínculo identificado e registrar a evidência. Não marcar todos os cedentes como sensíveis a tudo.

| Código | Rótulo exibido | Evidência a buscar |
|---|---|---|
| FAT-INV | Investimento do comprador | Pedido depende de projeto ou aquisição de ativo |
| FAT-PRO | Produção do comprador | Pedido acompanha unidades produzidas |
| FAT-USO | Uso da base instalada | Compra depende de horas, desgaste ou manutenção |
| FAT-REN | Renda do consumidor | Vendas finais dependem da renda disponível |
| FAT-CRE | Crédito do comprador | Financiamento viabiliza a compra |
| FAT-GIR | Custo e acesso ao capital de giro | Necessidade de financiar o ciclo operacional identificada |
| FAT-SAF | Safra e clima | Cultura, região ou operação afetada identificadas |
| FAT-COM | Preço de commodity | Commodity relevante para receita ou custo identificada |
| FAT-MOE | Câmbio | Receita, custo ou dívida em moeda estrangeira, direta ou indiretamente |
| FAT-ENE | Energia e combustível | Participação relevante no custo ou na receita identificada |
| FAT-IMP | Concorrência importada | Produto concorrente e mercado atingido identificados |
| FAT-EST | Estoques do canal | Reposição/formação/redução de estoque altera os pedidos |
| FAT-PUB | Orçamento público | Pagamento ou execução depende de orçamento público |
| FAT-TER | Pagamento de terceiros ao sacado | Fonte de caixa comum e dependência identificadas |
| FAT-SAZ | Sazonalidade | Calendário recorrente da demanda identificado |

Para cada fator marcado, preencher **direção do efeito**: Adversa / Favorável / Mista / Não identificada. A direção sempre se refere a uma mudança explícita, como alta do dólar ou queda da produção. Registrar o canal Receita / Custo / Caixa / Pagamento, permitindo mais de um canal.

Os fatores são atributos cruzados. Não somar suas participações como se fossem fatias exclusivas da carteira. O rótulo identifica o mecanismo; ele não atribui automaticamente uma intensidade nem uma nota de risco.

## 7. Dados mínimos para a futura atribuição aos cedentes

Esta seção orienta o desenho do cadastro, caso ele seja incluído. Não pressupõe que haja dados reais disponíveis.

| Campo | Conteúdo |
|---|---|
| Identificação | Cedente, CNPJ/grupo; sacado, CNPJ/grupo; título ou conjunto de títulos |
| Data e base | Data-base; carteira financiada ou receita total de período identificado |
| Valor | Saldo da parcela ou base de receita conhecida; não misturar os denominadores |
| Classificação | Código de setor, finalidade, motivo do CAPEX quando aplicável e aplicação |
| Atributos | Canal, mercado, essencialidade, durabilidade, repasse e natureza do pagador |
| Fatores | Lista de códigos de fatores relevantes, com mecanismo e evidência |
| Evidência | Fonte, data de verificação, qualidade e responsável |
| Rateio | Peso da parcela, método e parcela ainda não identificada |
| Histórico | Versão do catálogo e registro de alterações |

Não é preciso mostrar códigos técnicos ao usuário em toda a interface. Usar os rótulos legíveis; manter os códigos para armazenamento e consistência.

## 8. Regras de concentração e agregação

Se a implementação avançar para valores da carteira, preservar estas regras:

1. **Carteira financiada:** base gerencial inicial é o saldo de principal em aberto na data-base, com identificação de vencidos e a vencer. Não confundir com limite aprovado ou volume cedido no mês.
2. **Negócio do cedente:** composição de receita total exige fonte e período próprios. Não extrapolar a abertura dos títulos observados.
3. **Rateio:** para exposição i com saldo S_i e parcela p_ij na folha j, valor na folha j = soma de S_i × p_ij. Cada exposição soma 100%, incluindo desconhecidos.
4. **Hierarquia:** somar folhas para obter os pais. Não somar novamente os pais com os filhos.
5. **Fatores comuns:** uma parcela pode ter vários fatores, como dólar e crédito. Suas participações podem somar mais de 100%. Para um choque que reúne fatores, contar a união das parcelas, sem duplicá-las.
6. **Contaminação do cedente:** distinguir o saldo diretamente ligado ao choque do saldo total dos cedentes afetados. Uma linha de negócio pode pressionar a liquidez da empresa inteira. Não somar essas duas medidas.
7. **Demais concentrações:** cedente, sacado, grupo econômico, projeto, pagador econômico comum e região.
8. **Qualidade dos dados:** mostrar o valor/percentual não identificado. Campo ausente não é zero.
9. **Limites:** não inventar um teto universal de concentração nem um semáforo de risco como se estivesse calibrado.

## 9. Exemplos de consultas que o produto pode permitir

- “Quais cedentes estão ligados ao CAPEX de expansão do agro?”
- “Quais fornecedores de alimentos dependem de produção corrente e usam resina?”
- “Quais cedentes de setores diferentes têm custo ou dívida expostos ao dólar?”
- “Quanto da carteira depende de um mesmo sacado, grupo ou pagador econômico posterior?”
- “Quais parcelas ainda têm destino ou finalidade desconhecidos?”

O catálogo tem fator genérico para preço de commodity, câmbio e energia. Para filtrar uma matéria-prima específica, como resina, será necessário registrar o insumo correspondente. A lista fechada detalhada de materiais e a escala quantitativa de sensibilidade ainda não foram definidas; não tratá-las como decisões já tomadas.

As consultas identificam exposições e mecanismos. Não são previsões automáticas de perda. Uma queda de 5% na PIM não implica uma queda de 5% na receita nem na capacidade de pagamento de cada cedente.

## 10. Critérios para conferir o primeiro resultado

- A árvore mostra relações visíveis de pai e filho, do geral ao específico.
- Os nomes de nós e as opções de seleção vêm do catálogo.
- O usuário consegue reproduzir os três caminhos de alimentos apresentados neste arquivo.
- Os indicadores aparecem separados das classificações e das explicações.
- Motivo do CAPEX não aparece como campo de consumo ou manutenção rotineira.
- Uma empresa pode ter mais de um caminho quando suas parcelas forem identificadas.
- Estados desconhecidos são preservados, sem classificações inventadas.
- Exemplos fictícios não parecem dados reais da carteira.
- A leitura continua legível e as interações funcionam em larguras menores.
- Se houver saldos, pais/filhos e fatores sobrepostos não provocam dupla contagem.

## 11. Origem e referências

Base de conteúdo: apresentação `Economia_industrial_2027.pptx` da raiz do projeto anterior, com 46 slides, especialmente as partes de demanda, FBCF/CAPEX/OPEX, PIM, margem/caixa e classificação. Alguns rodapés tinham numeração diferente da posição do slide.

Chats consultados no trabalho original: “Queda do investimento industrial”, “Diferenciar mecanização e automação” e “Analisar cenário econômico do Brasil”. Trechos de “Setores De Margem Baixa” estavam reproduzidos em outro histórico; não houve acesso direto ao conteúdo integral desse chat.

Foram produzidos um modelo conceitual e depois um catálogo de rótulos. Este arquivo incorpora a versão corrigida do catálogo, que separa essencialidade de durabilidade e indicadores de classificação. Não é necessário carregar as versões anteriores para implementar.

Referências metodológicas usadas, disponíveis para esclarecimentos posteriores:

- [IBGE — PIM-PF](https://www.ibge.gov.br/estatisticas/economicas/industria/9294-pesquisa-industrial-mensal-producao-fisica.html): produção industrial por atividade e categorias de uso.
- [IBGE — Formação Bruta de Capital Fixo](https://ftp.ibge.gov.br/Contas_Nacionais/Sistema_de_Contas_Nacionais/Notas_Metodologicas_2010/13_formacao_bruta_capital_fixo.pdf): conceito e composição de investimento em ativos fixos.
- [CPC 27 — Ativo Imobilizado](https://www.cpc.org.br/Arquivos/Documentos/316_CPC_27_rev%2008.pdf): critérios de reconhecimento de ativos, substituições e manutenção.
- [Ipea — Consumo aparente de bens industriais](https://repositorio.ipea.gov.br/bitstreams/7e011071-4794-4eef-ab77-3725c5a6cab0/download): distinção entre produção doméstica e oferta disponível para a demanda interna.

Este briefing não carrega séries econômicas atualizadas, previsões para 2027, cadastro real de clientes, saldos ou um modelo estatístico de risco. Seu propósito é transferir o modelo de classificação e o contexto do produto para criar o HTML no novo projeto.
