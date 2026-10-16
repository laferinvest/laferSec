"""Verifica o XLSX entregue contra os dados e as evidências revisados."""
import collections, json, re, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT=Path(__file__).parent
rows=json.loads((ROOT/'data/industrias/lista_revisada.json').read_text(encoding='utf-8'))
out=ROOT.parent/'outputs/01a117c1-ac2e-7612-8584-485c4ed53815/Industrias_Recebiveis_Evidencias_Publicas.xlsx'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(out) as z:
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    def cells(file):
        doc=ET.fromstring(z.read(file));values={}
        for c in doc.findall('.//s:sheetData/s:row/s:c',ns):
            assert c.get('t')!='e',(file,c.attrib)
            v=c.find('s:v',ns)
            val=v.text if v is not None else ''
            if c.get('t')=='s': val=strings[int(val)]
            elif c.get('t')=='inlineStr': val=''.join(c.find('s:is',ns).itertext())
            values[c.get('r')]=val
        return doc,values
    main,mainvals=cells('xl/worksheets/sheet1.xml')
    cadastro,cadvals=cells('xl/worksheets/sheet2.xml')
    for i,r in enumerate(rows,7):
        assert re.sub(r'\D','',mainvals[f'A{i}'])==r['cnpj']
        assert mainvals[f'B{i}']==r['razao_social']
        assert mainvals[f'C{i}']==r['evidencia_resumo']
        assert mainvals[f'G{i}']==r['url_fonte']
        assert int(mainvals[f'H{i}'])==r['pagina']
        assert mainvals[f'I{i}']==r['trecho_evidencia']
        assert mainvals[f'J{i}']==r['contexto']
        assert cadvals[f'A{i}']==mainvals[f'A{i}']
        assert float(cadvals[f'C{i}'])==r['capital_social_numero']
        assert cadvals[f'D{i}']==r['municipio'] and cadvals[f'E{i}']==r['uf']
        assert cadvals[f'G{i}']==r['cnae_principal']
        assert not r['ja_constava_base_cvm_agosto']
        assert 10<=int(r['cnae_principal'][:2])<=33
        if r['fonte_id']!='guerra2025':
            assert (ROOT/'data/industrias'/(r['fonte_id']+'.pdf')).is_file()
    assert len(rows)==len({r['cnpj'] for r in rows})==17
    for filename in ['xl/tables/table1.xml','xl/tables/table2.xml']:
        table=ET.fromstring(z.read(filename));assert table.find('s:autoFilter',ns) is not None
    assert main.find('s:sheetViews/s:sheetView/s:pane',ns) is not None
    assert 'A24' not in mainvals
print(json.dumps({'resultado':'OK','cnpjs_empresas':len(rows),'repetidos_base_agosto':0,'abas':2,'fontes_e_capital_conferidos':True,'arquivo':str(out)},ensure_ascii=False))
