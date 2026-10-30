"""Acrescenta a aba criada por Artifact Tool, preservando as partes originais."""
from copy import deepcopy
import json, re, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from openpyxl import load_workbook

ROOT=Path(__file__).parent/'data'/'curadoria_industrias'
OUT=Path(__file__).parent.parent/'outputs'/'01a117c1-ac2e-7612-8584-485c4ed53815'/'Radar_CVM_Agosto_Curadoria_Industrias.xlsx'
N='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P='http://schemas.openxmlformats.org/package/2006/relationships'
C='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'s':N,'r':R}
ET.register_namespace('',N);ET.register_namespace('r',R)

def parse(data): return ET.fromstring(data)
def xml(el):
    # OPC exige que Types e Relationships usem o namespace padrão.
    ET.register_namespace('',el.tag.split('}')[0][1:])
    return ET.tostring(el,encoding='utf-8',xml_declaration=True)
def path_target(t): return t.lstrip('/') if t.startswith('/') else 'xl/'+t
def locate(parts,name):
    w=parse(parts['xl/workbook.xml']); rels=parse(parts['xl/_rels/workbook.xml.rels'])
    s=next(s for s in w.find('s:sheets',ns) if s.get('name')==name)
    r=next(r for r in rels if r.get('Id')==s.get('{'+R+'}id'))
    return path_target(r.get('Target'))

def main():
    with zipfile.ZipFile(ROOT/'google_original.xlsx') as z: original={n:z.read(n) for n in z.namelist()}
    with zipfile.ZipFile(ROOT/'artifact_curadoria.xlsx') as z: generated={n:z.read(n) for n in z.namelist()}
    decisions=json.loads((ROOT/'classificacao.json').read_text(encoding='utf8'))
    kept=[d for d in decisions if d['incluir']]; finalrow=len(kept)+6
    source_path=locate(original,'Empresas MG e SP')
    source=parse(original[source_path]); source_cells={c.get('r'):c for c in source.findall('.//s:sheetData/s:row/s:c',ns)}
    new=parse(generated[locate(generated,'Indústrias')])
    styles=parse(original['xl/styles.xml']); xfs=styles.find('s:cellXfs',ns); wraps={}
    sst=parse(generated['xl/sharedStrings.xml']) if 'xl/sharedStrings.xml' in generated else []
    for cell in new.findall('.//s:sheetData/s:row/s:c',ns):
        address=cell.get('r'); col=re.match('[A-Z]+',address).group(); row=int(re.search(r'\d+',address).group())
        oldrow=row if row<=6 else kept[row-7]['linha_original']
        oldcol=col if col<='H' else ('G' if col=='J' else 'B')
        if row==6 and col in ['I','J']: oldcol='G' if col=='I' else 'H'
        old=source_cells.get(f'{oldcol}{oldrow}')
        styleid=old.get('s','0') if old is not None else '0'
        if row>=7:
            if styleid not in wraps:
                wrapped=deepcopy(xfs[int(styleid)]); alignment=wrapped.find('s:alignment',ns)
                if alignment is None:
                    alignment=ET.Element('{'+N+'}alignment');wrapped.insert(0,alignment)
                alignment.set('wrapText','1');alignment.set('vertical','center');wrapped.set('applyAlignment','1')
                wraps[styleid]=str(len(xfs));xfs.append(wrapped);xfs.set('count',str(len(xfs)))
            styleid=wraps[styleid]
        cell.set('s',styleid)
        if cell.get('t')=='s':
            v=cell.find('s:v',ns); si=sst[int(v.text)]; cell.remove(v); cell.set('t','inlineStr')
            inline=ET.SubElement(cell,'{'+N+'}is')
            for ch in si: inline.append(deepcopy(ch))
    for row in new.findall('s:sheetData/s:row',ns): row.attrib.pop('s',None)
    for col in new.findall('s:cols/s:col',ns): col.attrib.pop('style',None)
    for tag in ['conditionalFormatting','dataValidations','tableParts','hyperlinks','legacyDrawing']:
        for item in list(new.findall('s:'+tag,ns)): new.remove(item)
    assert not source.findall('s:hyperlinks',ns), 'Revisar hyperlinks nativos antes de empacotar'
    # Reaproveita regras de status com os mesmos estilos diferenciais originais.
    for cf in source.findall('s:conditionalFormatting',ns):
        item=deepcopy(cf); item.set('sqref',re.sub(r'1058\b',str(finalrow),item.get('sqref'))); new.append(item)
    dv=source.find('s:dataValidations',ns)
    if dv is not None:
        dv=deepcopy(dv)
        for d in dv: d.set('sqref',f'A7:A{finalrow}')
        new.append(dv)
    tables=[p for p in original if re.fullmatch(r'xl/tables/[^/]+\.xml',p)]
    table=max((parse(original[p]) for p in tables),key=lambda t:int(t.get('id')))
    original_table=next(parse(original[p]) for p in tables if parse(original[p]).get('name')=='EmpresasFiltradas')
    newtable=deepcopy(original_table);newtable.set('id',str(int(table.get('id'))+1))
    newtable.set('name','IndustriasCuradas');newtable.set('displayName','IndustriasCuradas');newtable.set('ref',f'A6:J{finalrow}')
    af=newtable.find('s:autoFilter',ns)
    if af is not None: af.set('ref',f'A6:J{finalrow}')
    columns=newtable.find('s:tableColumns',ns);columns.set('count','10')
    ET.SubElement(columns,'{'+N+'}tableColumn',{'id':'9','name':'CNAE de fabricação'})
    ET.SubElement(columns,'{'+N+'}tableColumn',{'id':'10','name':'Fonte da classificação'})
    tp=ET.SubElement(new,'{'+N+'}tableParts',{'count':'1'})
    ET.SubElement(tp,'{'+N+'}tablePart',{'{'+R+'}id':'rId1'})
    newpath='xl/worksheets/industrias_curadas.xml';tablepath='xl/tables/industrias_curadas.xml'
    newrels=ET.Element('{'+P+'}Relationships')
    ET.SubElement(newrels,'{'+P+'}Relationship',{'Id':'rId1','Type':R+'/table','Target':'../tables/industrias_curadas.xml'})
    links=ET.SubElement(new,'{'+N+'}hyperlinks')
    for i,d in enumerate(kept,7):
        linkid='rId'+str(i-5)
        ET.SubElement(links,'{'+N+'}hyperlink',{'ref':f'J{i}','{'+R+'}id':linkid})
        ET.SubElement(newrels,'{'+P+'}Relationship',{'Id':linkid,'Type':R+'/hyperlink','Target':d['fonte_classificacao'],'TargetMode':'External'})
    order='sheetPr dimension sheetViews sheetFormatPr cols sheetData sheetCalcPr sheetProtection protectedRanges scenarios autoFilter sortState dataConsolidate customSheetViews mergeCells phoneticPr conditionalFormatting dataValidations hyperlinks printOptions pageMargins pageSetup headerFooter rowBreaks colBreaks customProperties cellWatches ignoredErrors smartTags drawing legacyDrawing legacyDrawingHF picture oleObjects controls webPublishItems tableParts extLst'.split()
    new[:]=sorted(list(new),key=lambda e:order.index(e.tag.split('}')[-1]))
    workbook=parse(original['xl/workbook.xml']);sheets=workbook.find('s:sheets',ns)
    sheetid=max(int(s.get('sheetId')) for s in sheets)+1
    rels=parse(original['xl/_rels/workbook.xml.rels'])
    rid='rId'+str(max(int(re.search(r'\d+',r.get('Id')).group()) for r in rels)+1)
    ET.SubElement(sheets,'{'+N+'}sheet',{'name':'Indústrias','sheetId':str(sheetid),'{'+R+'}id':rid})
    ET.SubElement(rels,'{'+P+'}Relationship',{'Id':rid,'Type':R+'/worksheet','Target':'worksheets/industrias_curadas.xml'})
    view=workbook.find('s:bookViews/s:workbookView',ns)
    if view is not None: view.set('activeTab',str(len(sheets)-1))
    content=parse(original['[Content_Types].xml'])
    for path,kind in [(newpath,'worksheet'),(tablepath,'table')]:
        ET.SubElement(content,'{'+C+'}Override',{'PartName':'/'+path,'ContentType':f'application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml'})
    output=dict(original)
    output.update({'xl/workbook.xml':xml(workbook),'xl/_rels/workbook.xml.rels':xml(rels),'[Content_Types].xml':xml(content),'xl/styles.xml':xml(styles),newpath:xml(new),tablepath:xml(newtable),'xl/worksheets/_rels/industrias_curadas.xml.rels':xml(newrels)})
    OUT.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in output.items(): z.writestr(name,data)
    changed=[p for p in original if original[p]!=output[p]]
    assert set(changed)=={'xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml','xl/styles.xml'}
    before=load_workbook(ROOT/'google_original.xlsx');after=load_workbook(OUT)
    for name in before.sheetnames:
        a=before[name];b=after[name]
        assert (a.max_row,a.max_column)==(b.max_row,b.max_column)
        for row in a:
            for c in row:
                t=b[c.coordinate];assert (c.value,c._style,c.number_format)==(t.value,t._style,t.number_format),(name,c.coordinate)
    src=before['Empresas MG e SP'];dst=after['Indústrias']
    for i,d in enumerate(kept,7):
        assert [c.value for c in dst[i][:8]]==[c.value for c in src[d['linha_original']][:8]],d['cnpj']
        assert re.sub(r'\D','',dst.cell(i,2).value)==d['cnpj']
        assert str(dst.cell(i,9).value)==d['cnae_industrial']
        label='Cadastro CNPJ' if d['motivo'].startswith('CNAE principal') else 'Fonte industrial'
        assert dst.cell(i,10).value==label
        assert dst.cell(i,10).hyperlink.target==d['fonte_classificacao']
    assert dst.max_row==finalrow and dst.max_column==10
    counts={src.cell(6,c).value:sum(src.cell(d['linha_original'],c).value is not None for d in kept) for c in [1,6,7,8]}
    report={'industrias':len(kept),'cnpjs_distintos':len({d['cnpj'] for d in kept}),'excluidas':len(decisions)-len(kept),'campos_preenchidos_preservados':counts,'abas_originais_preservadas':before.sheetnames,'saida':str(OUT.resolve())}
    (ROOT/'validacao_final.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report,ensure_ascii=True))

if __name__=='__main__':main()
