"""Arquivo e índice reproduzível de documentos públicos, sem informes mensais FIDC."""
import concurrent.futures, hashlib, json, re, sys, urllib.request
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).parent / 'data' / 'industrias'
ROOT.mkdir(parents=True, exist_ok=True)
PATTERN = re.compile(r'duplicatas?\s+descontad|desconto\s+de\s+duplicat|antecipa.{0,35}receb|cess.{0,40}receb|FIDC|cedid|endossad', re.I)

def one(row):
    key, url = row['id'], row['url']
    dest = ROOT / (key + '.pdf')
    try:
        if not dest.exists():
            req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=55) as response:
                data=response.read()
            if not data.startswith(b'%PDF'): raise ValueError('Resposta não é PDF')
            dest.write_bytes(data)
        pages=[p.extract_text() or '' for p in PdfReader(dest).pages]
        (ROOT/(key+'.pages.json')).write_text(json.dumps(pages,ensure_ascii=False),encoding='utf-8')
        hits=[]
        for i,page in enumerate(pages):
            normalized=' '.join(page.split())
            for m in PATTERN.finditer(normalized):
                hits.append({'pagina':i+1,'texto':normalized[max(0,m.start()-180):m.end()+750]})
        out={**row,'paginas':len(pages),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'hits':hits}
        (ROOT/(key+'.index.json')).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
        return {'id':key,'paginas':len(pages),'hits':len(hits),'cabecalho':' '.join(pages[0].split())[:450]}
    except Exception as e:
        return {'id':key,'erro':str(e)}

if __name__=='__main__':
    rows=json.loads((ROOT/'fontes.json').read_text(encoding='utf-8'))
    if '--pages' in sys.argv:
        key=sys.argv[2]
        pages=json.loads((ROOT/(key+'.pages.json')).read_text(encoding='utf-8'))
        for number in map(int,sys.argv[3:]):
            print(json.dumps({'pagina':number,'texto':' '.join(pages[number-1].split())},ensure_ascii=False))
        sys.exit()
    if '--brief' in sys.argv:
        for key in sys.argv[2:]:
            pages=json.loads((ROOT/(key+'.pages.json')).read_text(encoding='utf-8'))
            ids=sorted(set(re.findall(r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', '\n'.join(pages))))
            print(json.dumps({'id':key,'cnpjs':ids},ensure_ascii=False))
            for i,page in enumerate(pages):
                text=' '.join(page.split())
                matches=list(re.finditer(r'duplicatas?\s+descontad|desconto\s+de\s+(?:duplicat|receb)|antecipa.{0,20}receb|faturas\s+negociadas|cessões\s+de\s+créditos',text,re.I))
                if matches: print(json.dumps({'p':i+1,'header':text[:110],'hits':[text[max(0,m.start()-50):m.end()+330] for m in matches[:2]]},ensure_ascii=False))
        sys.exit()
    if '--inspect' in sys.argv:
        for key in sys.argv[2:]:
            p=ROOT/(key+'.pages.json')
            if not p.exists():continue
            pages=json.loads(p.read_text(encoding='utf-8'))
            ids=sorted(set(re.findall(r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', '\n'.join(pages))))
            print(json.dumps({'id':key,'cnpjs':ids,'cabecalho':' '.join(pages[0].split())[:300]},ensure_ascii=False))
            for i,page in enumerate(pages):
                text=' '.join(page.split())
                hits=[m for m in PATTERN.finditer(text) if not re.search(r'concedid|recuper.vel',m.group(),re.I)]
                if hits:
                    m=hits[0]
                    print(json.dumps({'pagina':i+1,'texto':text[max(0,m.start()-100):m.end()+1500]},ensure_ascii=False))
        sys.exit()
    if len(sys.argv)>1: rows=[r for r in rows if r['id'] in sys.argv[1:]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(one,rows):print(json.dumps(result,ensure_ascii=False),flush=True)
