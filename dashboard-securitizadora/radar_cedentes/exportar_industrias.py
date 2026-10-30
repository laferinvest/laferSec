"""Lista revisada manualmente: prova da própria empresa, sem informes FIDC de agosto."""
import collections, json, re, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from .cvm_fidc import normalize_cnpj

ROOT=Path(__file__).parent/'data'/'industrias'
cad={r['cnpj']:r for r in json.loads((ROOT/'cadastros.json').read_text(encoding='utf-8'))}
rows=[]

def add(cnpj,source,page,date,sector,mode,partner,quote,summary,context='',level='Operação com valor divulgado'):
    r=cad[cnpj]
    assert normalize_cnpj(cnpj)==cnpj
    assert 10<=int(r['cnae_principal'][:2])<=33,(cnpj,r['cnae_principal'])
    assert not r['ja_constava_base_cvm_agosto'],cnpj
    if source=='guerra2025':
        url='https://fnet.bmfbovespa.com.br/fnet/publico/exibirDocumento?id=1071579'
        sha=''
    else:
        doc=json.loads((ROOT/(source+'.index.json')).read_text(encoding='utf-8'))
        pages=json.loads((ROOT/(source+'.pages.json')).read_text(encoding='utf-8'))
        url=doc['url'];sha=doc['sha256']
        def clean(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
        assert clean(quote) in clean(pages[page-1]),(source,page,quote)
    value=str(r['capital_social']).replace('.','').replace(',','.')
    rows.append({**r,'capital_social_numero':float(value),'fonte_id':source,'url_fonte':url,
     'pagina':page,'data_evidencia':date,'setor':sector,'modalidade':mode,'contraparte':partner,
     'trecho_evidencia':quote,'evidencia_resumo':summary,'contexto':context,'tipo_comprovacao':level,
     'sha256_documento':sha,'data_coleta':datetime.now(timezone.utc).isoformat()})

add('61143632000107','alianca2024',28,'2024-12-31','Metalurgia e ferragens',
 'FIDCs e agentes de crédito','Multiplike; BS NP; IB Capital; bancos',
 'Operações realizadas com diferentes agentes de crédito na modalidade “duplicatas descontadas”',
 'A nota 12.1 identifica desconto de duplicatas com FIDCs. Em 2024, informa R$ 5,701 milhões com Multiplike, R$ 29 mil com BS NP e R$ 74 mil com IB Capital, além de outras contrapartes.')
add('22931823000173','qualipol2024',44,'2024-11-30','Tecelagem e embalagens plásticas',
 'Desconto de duplicatas','Não divulgada no trecho','DUPLICATAS DESCONTADAS',
 'O balancete sob o nome e CNPJ da Alliance registra saldo de R$ 3.858.836,49 em duplicatas descontadas no passivo.',
 'Fonte: administrador judicial. Balancete identificado como consolidado; não é soma atribuída ao grupo inteiro.')
add('01486546000167','cafebrasil2024',27,'2024-12-31','Fertilizantes',
 'Desconto de duplicatas','Não divulgada no trecho',
 'Em 31 de dezembro de 2024 a companhia tem em aberto em duplicatas descontadas 1.592.',
 'A nota de contas a receber informa R$ 1,592 milhão de duplicatas descontadas em aberto. A atividade produtiva descrita no documento é fabricação de fertilizantes.',
 'A evidência selecionada é desconto de duplicatas; outras dívidas descritas no balanço não integram esta pesquisa.')
add('33042730000104','csn2025',60,'2025-12-31','Siderurgia',
 'Cessão sem coobrigação','Não identificada no trecho',
 'A Companhia realiza operações de cessão de crédito sem coobrigação.',
 'A companhia declara cessão de duplicatas e títulos de clientes, com recebimento de recursos e baixa do contas a receber. A página seguinte registra R$ 75,338 milhões de encargos dessas cessões na controladora em 2025.',
 'Ver também página 61. Encargos são despesas da operação, não o volume antecipado.')
add('11807230000183','serpro197280',10,'2024-12-31','Fabricação de colchões',
 'Desconto de duplicatas','Não identificada no trecho','DUPLICATAS DESCONTADAS',
 'O balanço SPED-ECD da própria empresa apresenta saldo de R$ 138.242,06 em duplicatas descontadas em 31/12/2024.',
 'CNPJ e razão social identificados na página 1 do arquivo oficial.')
add('61532198000149','delga2025',44,'2025-12-31','Autopeças e estamparia',
 'Antecipação bancária sem coobrigação','Instituição bancária não nomeada',
 'O saldo refere-se à operação bancária de antecipação de recebíveis',
 'A nota 6 apresenta R$ 22,001 milhões de antecipação sobre contas a receber de clientes em 2025 e descreve operação bancária sem coobrigação.')
add('07880049000125','flormel2024',35,'2024-12-31','Alimentos',
 'Cessão com coobrigação','Instituições financeiras',
 'relacionadas a duplicatas a receber originadas de vendas a prazo.',
 'A nota 20 explica que a companhia cede direitos de duplicatas das próprias vendas a prazo a instituições financeiras, recebe antecipadamente e retém risco de crédito. Há saldo positivo registrado em outros passivos.')
add('31008318000142','guerra2025',15,'2025-09-30','Implementos rodoviários',
 'Securitização de duplicatas','VERT Companhia Securitizadora',
 'correspondem a duplicatas comerciais endossadas pela Guerra Implementos Rodoviários S.A.',
 'A nota 7 identifica duplicatas comerciais endossadas pela fabricante à estrutura da VERT. O CNPJ da empresa foi confirmado no cadastro público e no campo de cedente de OTS de março/2026.',
 'Caso já apresentado na planilha anterior de duplicatas, mantido como referência. O relatório também registra insuficiência de lastro; ver notas de auditoria. O CNPJ 25.005.683/0001-09 da capa pertence à VERT e não é o CNPJ deste lead.')
add('89637490000145','recebiveis2025',64,'2025-12-31','Papel, celulose e embalagens',
 'Desconto de recebíveis com bancos','Bancos, sem nome no trecho',
 'foram realizadas operações de desconto de recebíveis com clientes específicos',
 'A nota 7.2 informa operações de desconto de recebíveis de R$ 7,766 bilhões na controladora durante 2025, com transferência dos riscos e benefícios à contraparte.',
 'O valor corresponde ao fluxo anual de operações, não ao saldo no fim do ano.')
add('05917486000140','livetech2025',55,'2025-09-30','Equipamentos de telecomunicações',
 'Desconto bancário com regresso','Banco Daycoval',
 'duplicatas descontadas junto a instituições financeiras',
 'A nota 14.1 apresenta duplicatas de clientes descontadas no Daycoval, com regresso. Registra R$ 49,067 milhões descontados e R$ 43,904 milhões líquidos de juros a apropriar.')
add('03853896000140','marfrig2025',62,'2025-12-31','Frigorífico bovino',
 'Cessão para FIDC','FIDC MRFG','faturas negociadas com o fundo MRFG',
 'A companhia explica que aliena ao FIDC recebíveis de vendas a prazo no mercado interno. Em 31/12/2025, informa R$ 127,446 milhões de faturas negociadas com o fundo.')
add('83250084000149','maitu2025',30,'2025-07-31','Postes e artefatos de concreto',
 'Desconto com FIDC e outras contrapartes','MACCRED FIDC NP; FAMCRED; RV',
 'DUPLICATAS DESCONTADAS MACCRED - FIDC MACCRED NP',
 'O balanço sob o CNPJ da Maitu apresenta R$ 1.157.643,91 em duplicatas descontadas, incluindo R$ 1.017.656,50 identificados com o MACCRED FIDC NP.',
 'Documento de recuperação judicial. A evidência é do balanço da Maitu, não de informe mensal do fundo.')
add('87833737000173','pisani2024',4,'2024-12-31','Embalagens e artefatos plásticos',
 'Uso de antecipação descrito em nota','Não divulgada',
 'redução da necessidade de operações de antecipação de recebíveis da companhia.',
 'A nota de contas a receber relaciona o aumento da carteira de clientes à redução da necessidade de antecipar recebíveis da própria companhia.',
 'Comprovação narrativa e histórica. A nota não quantifica antecipações nem identifica o financiador; não permite afirmar uso atual.',
 'Narrativa de uso; sem valor divulgado')
add('05988913000181','portalplast2024',27,'2024-12-31','Laminados plásticos',
 'Desconto de duplicatas','Não identificada no trecho',
 'Juros sobre desconto de duplicatas',
 'A nota de resultado financeiro registra R$ 5,456 milhões de juros sobre desconto de duplicatas no exercício de 2024.',
 'O valor é despesa financeira, não o valor dos títulos descontados. O CNPJ foi conferido no cadastro público; o CNPJ do auditor não foi usado como lead.')
add('23826083000178','qualipol2024',48,'2024-11-30','Tecelagem e materiais plásticos',
 'Desconto de duplicatas','Não divulgada no trecho','DUPLICATAS DESCONTADAS',
 'O balancete identificado com o nome e CNPJ da Qualipol apresenta saldo de R$ 88.660.185,68 em duplicatas descontadas. O administrador judicial explica a natureza de antecipação dessas operações na página 26.',
 'Fonte: administrador judicial. Balancete identificado como consolidado sob o CNPJ da Qualipol; os R$ 100,2 milhões do grupo não foram atribuídos a este CNPJ.')
add('15115504000124','tronox2025',37,'2025-12-31','Pigmentos e produtos químicos',
 'Antecipação com transferência do risco','Instituições financeiras',
 'a Companhia realizou a antecipação de recebíveis junto a instituições financeiras',
 'A nota 6 informa R$ 386,279 milhões antecipados em 2025 e deságio de R$ 10,310 milhões. Declara que o risco de crédito ficou com a instituição financeira.',
 'O valor antecipado corresponde ao movimento do exercício, não ao saldo em 31/12.')
add('93899359000123','venancio2024',18,'2024-12-31','Equipamentos de cozinha',
 'Desconto de duplicatas descrito em relatório','Não divulgada',
 'quantias vinculadas a duplicatas descontadas e aos clientes do mercado interno.',
 'O administrador judicial atribui a redução mensal de contas a receber de clientes, em parte, aos valores vinculados a duplicatas descontadas.',
 'Documento de recuperação judicial. A passagem não individualiza o financiador ou o valor dos descontos; não permite afirmar uso atual.',
 'Narrativa de uso; sem valor divulgado')

rows.sort(key=lambda r:(r['tipo_comprovacao'].startswith('Narrativa'),r['razao_social']))
assert len({r['cnpj'] for r in rows})==len(rows)
quotes=collections.defaultdict(list)
for r in rows:quotes[r['fonte_id']].append(r['trecho_evidencia'])
assert all(sum(len(q.split()) for q in qs)<=25 for qs in quotes.values())
(ROOT/'lista_revisada.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
report={'empresas':len(rows),'adicionais_ao_caso_guerra':len(rows)-1,
 'cnpjs_ja_presentes_base_agosto':sum(r['ja_constava_base_cvm_agosto'] for r in rows),
 'com_valor':sum(not r['tipo_comprovacao'].startswith('Narrativa') for r in rows),
 'narrativas':sum(r['tipo_comprovacao'].startswith('Narrativa') for r in rows),
 'periodo_evidencias':[min(r['data_evidencia'] for r in rows),max(r['data_evidencia'] for r in rows)],
 'criterios':'Somente CNAE principal de transformação (divisões 10 a 33), prova de recebíveis próprios. Sem operações CRI/CRA ou informes mensais FIDC de agosto. CNPJs já presentes na base anterior de agosto excluídos por comparação local.',
 'exclusoes':'BRF e Mundial: CNPJ já na base anterior. Artposte, Traço Forte e Provale: atividade principal fora da transformação. Bakof/Fibracampo: arquivo indisponível para download. Holdings, sacados e garantias isoladas não incluídos.'}
(ROOT/'relatorio_revisao.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
