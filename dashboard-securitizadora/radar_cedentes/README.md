# Radar de cedentes — primeiro coletor CVM/FIDC

Começamos por um script Python determinístico. O primeiro estágio identifica
CNPJs explicitamente declarados como cedentes nos informes mensais, valida
o documento e preserva a evidência. O segundo estágio confere o cadastro de
cada CNPJ, exclui fundos/classes e exporta empresas com CNPJ e razão social.
Não depende de um modelo de IA ou de uma chave de API.

## Fontes verificadas em 7 de outubro de 2026

| Recurso oficial | Uso |
| --- | --- |
| [Conjunto FIDC: Informe Mensal](https://dados.cvm.gov.br/dataset/fidc-doc-inf_mensal) | Descrição do conjunto e política de atualização |
| [Diretório dos ZIPs mensais](https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/) | Descoberta automática dos arquivos disponíveis |
| [Histórico anual](https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/HIST/) | Competências anteriores, em ZIPs por ano |
| [Dicionário oficial em ZIP](https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/META/meta_inf_mensal_fidc_txt.zip) | Nomes e descrições de colunas |
| [Padrão XML do informe](https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/PadroesXML/PadraoXMLMensalFIDC576.asp) | Significado dos campos e instruções de preenchimento |
| [Cadastro de fundos/classes](https://dados.cvm.gov.br/dataset/fi-cad) | Exclusão de fundos/classes da lista de empresas |
| [Minha Receita](https://docs.minhareceita.org/) | Consulta da razão social pelo CNPJ completo; fonte secundária dos dados públicos da Receita Federal |

O portal informa atualização semanal dos informes recentes, incluindo
reapresentações. O diretório consultado tinha ZIPs mensais de 2025/2026 e
históricos anuais de 2013 a 2024. A descoberta usa os links publicados, em vez
de assumir que um endereço construído sempre existe.

O ZIP `inf_mensal_fidc_202608.zip` contém 18 CSVs. Para identificar os cedentes,
o arquivo necessário é **`inf_mensal_fidc_tab_I_202608.csv`**. CSVs são separados
por ponto e vírgula. Nos arquivos reais examinados, os percentuais usam ponto
decimal; o parser também aceita vírgula. A leitura tenta UTF-8 e depois Latin-1.
Não é necessário visitar um fundo de cada vez: o arquivo reúne os informes
disponíveis daquela competência.

## Campos exatos encontrados

| Campo no CSV | Interpretação |
| --- | --- |
| `TAB_I2A12_CPF_CNPJ_CEDENTE_1` a `_9` | CPF/CNPJ do cedente, bloco com aquisição substancial dos riscos e benefícios |
| `TAB_I2A12_PR_CEDENTE_1` a `_9` | Participação percentual correspondente no bloco A |
| `TAB_I2B12_CPF_CNPJ_CEDENTE_1` a `_9` | CPF/CNPJ do cedente, bloco sem aquisição substancial dos riscos e benefícios |
| `TAB_I2B12_PR_CEDENTE_1` a `_9` | Participação percentual correspondente no bloco B |
| `CNPJ_FUNDO_CLASSE`, `TP_FUNDO_CLASSE` | Identidade e tipo da entidade reportada |
| `CNPJ_FUNDO` | Alternativa de identificação prevista para layouts antigos |
| `DENOM_SOCIAL` | Nome do fundo/classe, **não** razão social do cedente |
| `DT_COMPTC` | Data da competência, **não** data da coleta |
| `ADMIN`, `CNPJ_ADMIN` | Administrador informado naquela competência |
| `CLASSE`, `CNPJ_CLASSE`, `CLASSE_UNICA` | Contexto de classe presente no layout atual |

Os blocos de cedentes são associados à divulgação de participações acima de
10% do patrimônio líquido, segundo as instruções do XML. Isso é um critério de
divulgação e não prova descumprimento de um limite. Há valores reais abaixo de
10% e acima de 100%: são preservados e sinalizados para revisão. O percentual é
guardado em pontos percentuais, como `69.48`, sem dividir por 100 nem calcular
uma participação alternativa na carteira. O registro mantém a base do percentual.

O parser só usa os campos que nomeiam **CEDENTE**. Não identifica sacados,
administradores ou gestores como cedentes por coincidirem com algum CNPJ.

## Arquitetura implementada

```text
Índice público da CVM
  → download do ZIP mensal ou anual
  → cópia imutável identificada por SHA-256
  → tabela I e validação do layout
  → campos CPF/CNPJ de cedente e percentuais correspondentes
  → validação e normalização do CNPJ como texto
  → SQLite: cedentes + evidências + coletas
  → cadastro CVM de fundos/classes para exclusão da lista comercial
  → consulta cadastral do CNPJ exato e cache da razão social
  → CSV de empresas: apenas CNPJ e razão social
```

São quatro tabelas:

- `cedentes`: um identificador declarado por CNPJ completo, incluindo filiais;
- `evidencias`: cada aparição em arquivo, registro e campo, com fonte e valores;
- `coletas`: execução, competências, hash, estatísticas e motivos de rejeição.
- `cadastro_cedentes`: razão social consultada pelo CNPJ exato, fonte, data e
  classificação da entidade; fundos/classes não entram no CSV de empresas.

Um CNPJ válido nos campos de cedente não garante que a entidade seja uma
empresa: os informes também contêm fundos, classes, órgãos e associações.
O exportador de empresas remove os CNPJs do cadastro de fundos/classes CVM,
remove a natureza jurídica 2224 (fundo de investimento) e conserva entidades
empresariais do grupo 2 da natureza jurídica. Não usa palavras no nome para
excluir uma empresa. Administrador/gestor do fundo também não são excluídos
por essa função: só o CNPJ do próprio fundo/classe é usado no cruzamento.

Cada evidência contém os campos solicitados, além de CNPJ da classe,
administrador, bloco de riscos/benefícios, arquivo CSV, número do registro,
linha final no CSV, campo de identificação, campo do percentual, dados originais,
alertas, versão do parser e localização do ZIP preservado. `pagina` fica nula
porque a origem é CSV. O registro CSV é contado sem o cabeçalho; a linha final
é a contagem física do leitor, incluindo cabeçalho e eventuais quebras de linha.

Um mesmo CNPJ pode ter várias evidências. Não se deve deduplicar a tabela de
evidências pelo CNPJ: isso apagaria fundos, meses e fontes. Também não se somam
automaticamente os percentuais dos blocos A/B.

A reexecução de um ZIP não duplica suas evidências. Quando uma competência é
reprocessada com outro conteúdo, as evidências da versão anterior continuam
no histórico e deixam de ter `vigente_na_fonte=1`. Esse indicador significa
"presente na última versão importada da competência", não "empresa continua
cedendo hoje". Reimportar manualmente um ZIP antigo torna aquela versão a
última importada. Datas de coleta e verificação são guardadas em UTC.

Toda a entrada é analisada antes de reconciliar sua competência em uma
transação. Se faltar um campo de identificação/participação, surgirem campos
novos não mapeados, ou houver identidade/data inválida, a importação daquela
entrada falha sem apagar as evidências anteriores. Uma execução com vários
ZIPs confirma cada ZIP separadamente: eventual falha posterior não desfaz
os ZIPs anteriores já confirmados.

## Executar

Requer Python 3.11 ou superior. Não é necessário instalar bibliotecas adicionais.
Executar a partir da pasta `dashboard-securitizadora`.

Uma competência, baixando da CVM:

```powershell
python -m radar_cedentes.cvm_fidc --mes 202608
```

Os 12 meses mais recentes publicados:

```powershell
python -m radar_cedentes.cvm_fidc --ultimos 12
```

Após coletar a competência, preencher a razão social e exportar empresas:

```powershell
python -m radar_cedentes.empresas_cedentes
```

A consulta é limitada a três requisições concorrentes e um intervalo global
mínimo de 0,35 segundo. Os resultados são guardados por CNPJ e uma execução
interrompida pode ser retomada. Respostas com outro CNPJ ou sem razão social
são rejeitadas. Erros temporários têm retentativas limitadas; CNPJs sem cadastro
resolvido ficam separados, sem inventar nomes nem exportar nomes vazios.

Para gerar o resultado com o cadastro já baixado, sem novas consultas:

```powershell
python -m radar_cedentes.empresas_cedentes --offline
```

Para pesquisar o capital social das empresas já filtradas:

```powershell
python -m radar_cedentes.capital_social
```

A consulta do capital usa o [OpenCNPJ](https://opencnpj.org/), com limite global
de cinco requisições por segundo e cinco consultas concorrentes. Cada resposta
deve corresponder ao CNPJ completo solicitado. O valor é guardado como decimal
em reais, preservando centavos e distinguindo zero informado de campo ausente.
As respostas limitadas aos campos necessários ficam em `capital_social/`, com
URL, data da consulta e hash; não é armazenado o quadro societário da resposta.

Capital social é um atributo da empresa, identificado pelos oito primeiros
dígitos do CNPJ, conforme o [layout oficial da Receita Federal](https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf/@@download/file).
Filiais da mesma empresa compartilham o valor cadastral; seus CNPJs e nomes
originais são mantidos na lista. O capital consultado não é um valor histórico
da competência do informe CVM. Não é somado um total que duplique as filiais.

O modo `--offline` reutiliza essas consultas. As saídas são
`exports/empresas_cedentes_capital.json` e `exports/relatorio_capital_social.json`.
O primeiro arquivo conserva todas as linhas da lista e a fonte individual do
capital; não remove empresas por não conseguir consultar um valor.

Mais de uma competência e uma pasta de saída específica:

```powershell
python -m radar_cedentes.cvm_fidc --mes 202607 --mes 202608 --data-dir radar_cedentes/data
```

Para validar um ZIP já baixado, sem acessar a rede:

```powershell
python -m radar_cedentes.cvm_fidc --mes 202608 --zip radar_cedentes/data/raw/inf_mensal_fidc_202608.zip
```

Um mês contido no histórico anual:

```powershell
python -m radar_cedentes.cvm_fidc --mes 202412 --zip radar_cedentes/data/raw/inf_mensal_fidc_2024.zip
```

O computador desta implementação possui um Python fornecido pelo Codex.
Se `python` não estiver disponível no terminal, o comando validado neste
ambiente foi:

```powershell
& 'C:\Users\danie\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m radar_cedentes.cvm_fidc --mes 202608
```

O modo online consulta os índices e baixa os arquivos novamente, para captar
reapresentações. Não foi instalado um agendamento nesta etapa. Para atualização
recorrente, o comando `--ultimos 12` pode futuramente ser executado semanalmente.

As saídas ficam em `radar_cedentes/data/`:

- `radar.sqlite3`: base local;
- `raw/<sha256>/<nome original>.zip`: evidência original preservada;
- `exports/empresas_cedentes.csv`: lista comercial com apenas `cnpj` e `razao_social`;
- `exports/cedentes.csv`: identificadores declarados com datas/contagens, para auditoria;
- `exports/evidencias.csv`: evidências das últimas versões importadas;
- `exports/historico_evidencias.csv`: todas as versões preservadas;
- `exports/relatorio_coleta.json`: resultados da última execução.
- `cadastro_cnpj/<cnpj>.json`: nome e natureza jurídica consultados, URL/data/hash;
- `exports/exclusoes_empresas.json`: entidades retiradas da lista comercial;
- `exports/cadastros_pendentes.json`: CNPJs sem nome/classificação resolvidos.

Ao importar o CSV no Excel, escolher **texto** para a coluna CNPJ para manter
zeros à esquerda. O SQLite já guarda CNPJ como texto. Arquivos de dados e
bases locais ficam fora do Git pelo `.gitignore` deste diretório.

## Validação com dados reais

Execução de agosto/2026 em 7/10/2026:

| Métrica | Quantidade |
| --- | ---: |
| Registros de fundos/classes na tabela I | 4.400 |
| Campos de identificação preenchidos | 3.597 |
| Evidências com CNPJ validado | 3.464 |
| CNPJs únicos declarados, antes da filtragem de empresas | 2.424 |
| CPF ou identificador de até 11 posições, excluído da base empresarial | 131 |
| Identificadores com dígitos verificadores inválidos | 2 |
| Recuperações de zeros à esquerda com DV válido | 20 |
| Evidências com percentual até 10%, sinalizadas | 358 |
| Evidências com percentual acima de 100%, sinalizadas | 331 |

O ZIP preservado tem SHA-256
`dce9a173f513f811b82cb1b60684429377d38e3587adfed13cbda3744d65e517`.
Essas quantidades correspondem ao conteúdo baixado; novas apresentações
podem alterar os resultados.

Após o cadastro e a filtragem, a entrega corrigida de agosto/2026 contém
**2.168 CNPJs de empresas**, com razão social consultada pelo CNPJ exato.
Foram excluídos 216 fundos/classes, 39 entidades de outras naturezas jurídicas
e separado 1 CNPJ sem cadastro encontrado (75.476.959/0001-05). Filiais com
CNPJs diferentes permanecem separadas. Todas as 3.464 evidências foram
conferidas novamente contra o ZIP original; as exclusões não apagam a prova.
O Excel entregue tem uma única aba e apenas CNPJ e razão social.

Também foi validado o download automático de setembro/2026 em uma base de
teste: 428 registros, 395 evidências e 242 CNPJs únicos. Esse arquivo tinha
bem menos registros que agosto no momento da coleta; não deve ser tratado
como uma competência com cobertura completa só porque o ZIP já existe.
O histórico anual de 2024 foi validado para dezembro: 3.157 registros,
2.008 evidências e 1.470 CNPJs únicos, em outra base de teste.

Testes automatizados:

```powershell
python -m unittest radar_cedentes.test_cvm_fidc radar_cedentes.test_empresas_cedentes -v
```

Cobrem validação de CNPJ, o exemplo alfanumérico oficial da Receita, zeros
à esquerda, exclusão de CPF, separação entre cedente/sacado/fundo, percentuais,
UTF-8/Latin-1, mudanças de layout, deduplicação, múltiplos fundos/meses,
reapresentações e preservação dos arquivos. O algoritmo do DV segue o
[manual técnico da Receita](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).

## Limitações e próximas etapas

Esta versão identifica a evidência de cessão já declarada; não avalia a
adequação comercial do lead ou a situação atual da empresa. Empresas sem
participação divulgada nesses campos podem não aparecer.

`razao_social`, `gestor` e `tipo_direito_creditorio` permanecem nulos na evidência
original quando ausentes no informe. A razão social do cadastro consultado é
guardada separadamente em `cadastro_cedentes` e alimenta o exportador de empresas.
O cadastro consultado não prova o nome histórico na competência do informe.
Não usamos o nome do fundo como razão social da empresa e não atribuímos a um
cedente o tipo predominante da carteira.
A tabela II descreve segmentos da carteira do fundo/classe, mas não estabelece
uma relação individual segmento→cedente. O bloco de riscos/benefícios é
armazenado separadamente do tipo de crédito.

`CNPJ_FUNDO_CLASSE` pode representar uma classe. Quando o tipo é `Classe`,
preenchemos `cnpj_classe`; o CNPJ do fundo pai fica nulo até existir um vínculo
cadastral verificável. Enriquecimentos devem manter sua própria fonte e data:
o cadastro atual não comprova quem era o gestor no mês de uma evidência antiga.

Identificadores de até 11 posições não são completados para CNPJ: podem ser
CPF ou dados ambíguos. CNPJs numéricos de 12/13 posições só são completados
quando passam no DV. O suporte ao CNPJ alfanumérico foi testado, embora os
identificadores de cedentes examinados em agosto fossem numéricos.

Para os outros dois coletores, a base proposta permanece a mesma:

```text
CVM/FIDC ────────────────┐
Fundos.NET/B3 ───────────┼→ normalização do CNPJ → cedentes + evidências
Prospectos/ofertas ──────┘
```

O coletor de informes de CRI/CRA do Fundos.NET foi implementado em 15/10/2026,
conforme descrito abaixo. Prospectos ainda não foram implementados. Neles,
scripts devem descobrir/baixar os
documentos e tentar extrair o texto. OCR e IA podem ajudar em PDFs complexos;
a extração deve conservar página, trecho, papel e contexto. Uma ocorrência
de CNPJ perto da palavra "cedente" não basta, e uma empresa prevista como
possível cedente de uma oferta deve ser distinguida de cessão já realizada.

A razão social e a filtragem de empresas já foram implementadas. A próxima
ampliação possível é a janela de competências e os dois coletores documentais.

Cidade e estado são enriquecidos por `python -m radar_cedentes.localizacao`,
consultando o CNPJ completo no OpenCNPJ e verificando a identidade da resposta,
inclusive o número da filial. `--offline` reutiliza as consultas armazenadas.
O cadastro consultado em 9/10/2026 não representa necessariamente o endereço
histórico da evidência CVM. Os registros originais e suas fontes permanecem em
`data/localizacao` e na tabela `localizacao_cedentes`; a exportação está em
`data/exports/empresas_cedentes_localizacao.json`.
Para os três cadastros no exterior, `data/localizacao_complementos.json`
documenta as fontes da cidade e da divisão administrativa equivalente ao estado,
sem substituir o registro original da consulta cadastral.

## Cedentes de CRI/CRA divulgados pelo Fundos.NET

`python -m radar_cedentes.securitizadoras --ano 2026` lê os informes de
securitizadoras enviados pelo Fundos.NET e consolidados em dados abertos pela
CVM. Fontes: `securit-doc-inf_mensal_cri` e `securit-doc-inf_mensal_cra` no
portal da CVM, arquivos anuais `inf_mensal_cri_2026.zip` e
`inf_mensal_cra_2026.zip`. A extração usa as tabelas `cedente_devedor`,
exclusivamente as linhas `Tipo=Cedente`; `CNPJ_Emissora` identifica somente a
securitizadora e jamais é usado como CNPJ do lead. A união com a tabela `geral`
usa emissora, código do certificado, competência e versão. CPF, identificador
inválido, fundo/classe e outra natureza jurídica não entram na lista de empresas.
Empresas que só apresentam percentual zero/ausente ficam fora da exportação.

O percentual dessas tabelas é uma fração: `1` representa `100%`. Sua escala é
conferida contra o campo `CedentesRepresentamMais20Porcento` do XML original,
com tolerância de 1e-10 para a representação decimal do consolidado. Isso é
diferente dos pontos percentuais usados no coletor FIDC. Não se usa o quadro
de devedores nem limites contratuais como prova de cessão.

`python -m radar_cedentes.fnet_documentos --completo` consulta os metadados
públicos de informes de CRI/CRA do Fundos.NET, tipos 86/81, com paginação de 200
registros, e confere XMLs originais. O vínculo exige código da operação,
competência, versão no índice, CNPJ da emissora e CNPJ do cedente no bloco
específico de cedentes. Os originais ficam em `data/fnet/originais`, com hash.
Falhas temporárias individuais mantêm como fonte o CSV oficial preservado,
sem inventar link de documento. A paginação e os cadastros têm cache e limite
global de requisições. As evidências também ficam na tabela SQLite
`evidencias_securitizadoras` e nos arquivos JSON de `data/fnet`.

`python -m radar_cedentes.securitizadoras_export` prepara a lista empresarial
deduplicada por CNPJ completo e uma evidência por empresa para a planilha.
O histórico completo de aparições é preservado. O recorte de 2026 disponível
em 15/10/2026 contém CRI de janeiro a setembro e CRA de janeiro a agosto.
Os endereços e capitais são cadastrais, consultados em outubro de 2026.
Esta etapa cobre os informes mensais estruturados de CRI/CRA; não é uma
varredura de todos os PDFs, relatórios e documentos já publicados pela B3.

## Recorte comercial solicitado pelo usuário

O objetivo comercial é localizar indústrias que antecipam recebíveis das
próprias vendas: duplicatas e faturas cedidas a FIDCs/securitizadoras. A lista
de CRI/CRA acima não está qualificada para esse objetivo. CNAE industrial ou
um nome de indústria na emissão não comprova cessão dos seus recebíveis.
Uma nota comercial emitida pela indústria é dívida da indústria. Cessão
fiduciária em garantia também não deve ser confundida automaticamente com
antecipação de carteira de vendas. Páginas que oferecem antecipar títulos
"contra" determinada empresa identificam um sacado, não necessariamente um cedente.

`ots_investigacao` preserva os informes de Outros Títulos de Securitização
de 2023 a 2026, e `ots_comerciais` cruza o CNPJ explicitamente declarado
`Tipo=Cedente` com o contexto da emissão, competência e versão. Só admite
lastro explicitamente descrito como duplicatas, créditos mercantis ou notas
fiscais; casos genéricos ou de dívida sem prova de carteira comercial não
entram automaticamente. Na pesquisa em 15/10/2026, os 5.173 informes gerais
continham 24 CNPJs distintos nos campos de cedente, e o único confirmado
pelo cruzamento estrito de lastro e CNPJ foi Guerra Implementos Rodoviários
S/A, 31.008.318/0001-42, lastro em duplicatas. Isso não significa que não
existam outros cedentes: identifica somente o que esses dados comprovam.

A comprovação documental adicional está na página 15 do PDF Fundos.NET
1071579, nota 7: duplicatas comerciais endossadas pela Guerra. O CNPJ do
cedente vem do informe mensal, e não do cabeçalho do PDF, cujo CNPJ é o da
securitizadora. A data do relatório auditado (30/09/2025) é distinta da
competência do registro cadastral de cedente escolhido (03/2026).
`ots_confirmado` prepara a exportação com essas duas evidências separadas.
