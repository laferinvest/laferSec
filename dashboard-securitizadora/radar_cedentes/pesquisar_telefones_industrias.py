"""Pesquisa de telefones empresariais públicos, com evidência e sem QSA."""
import concurrent.futures, hashlib, json, re, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from html.parser import HTMLParser

class PublicHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.parts=[];self.links=[];self.anchor=None;self.hidden=0;self.intitle=False;self.title=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript','svg'):self.hidden+=1
        if tag=='title':self.intitle=True
        if tag=='a' and not self.hidden:
            attrs=dict(attrs);self.anchor={'href':attrs.get('href',''),'label':[],'position':len(' '.join(self.parts))}
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript','svg'):self.hidden=max(0,self.hidden-1)
        if tag=='title':self.intitle=False
        if tag=='a' and self.anchor is not None:
            self.anchor['label']=' '.join(self.anchor['label']);self.links.append(self.anchor);self.anchor=None
    def handle_data(self,data):
        if self.hidden:return
        s=data.strip()
        if s:
            self.parts.append(s)
            if self.intitle:self.title.append(s)
            if self.anchor is not None:self.anchor['label'].append(s)

ROOT=Path(__file__).parent/'data'/'telefones_industrias'
UA={'User-Agent':'Mozilla/5.0'}
LOCK=threading.Lock();NEXT=0.0
FREE={'gmail.com','hotmail.com','outlook.com','yahoo.com','yahoo.com.br','uol.com.br','terra.com.br','bol.com.br','live.com','msn.com','icloud.com','ig.com.br','aol.com','globo.com','oi.com.br','outlook.com.br','hotmail.com.br','yahoo.com.br'}
PHONE=re.compile(r'(?<!\d)(?:\+?55[\s.\-]*)?\(?([1-9]\d)\)?[\s.\-]*([2-9]\d{3,4})[\s.\-]*(\d{4})(?!\d)')
CNPJ=re.compile(r'\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b')
BAD=re.compile(r'contab|contabil|assessor|advoc|escritorio|fiscal|consultor|hotmail|gmail',re.I)

def clean_phone(raw):
    n=re.sub(r'\D','',str(raw))
    if len(n) in (12,13) and n.startswith('55'):n=n[2:]
    if len(n) not in (10,11) or n[0]=='0' or len(set(n))<3:return None
    return f'({n[:2]}) {n[2:-4]}-{n[-4:]}'

def get(url,timeout=18):
    req=urllib.request.Request(url,headers=UA)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        data=r.read(2500000); final=r.geturl(); charset=r.headers.get_content_charset() or 'utf-8'
    return data,final,charset

def cadastro(cnpj):
    global NEXT
    dest=ROOT/'cadastro'/f'{cnpj}.json'
    if dest.exists():return json.loads(dest.read_text(encoding='utf8'))
    url='https://api.opencnpj.org/'+cnpj
    for attempt in range(3):
        with LOCK:
            pause=max(0,NEXT-time.monotonic());NEXT=max(NEXT,time.monotonic())+.28
        if pause:time.sleep(pause)
        try:
            raw,_,_=get(url);d=json.loads(raw)
            assert re.sub(r'\D','',d['cnpj'])==cnpj
            phones=[]
            for item in d.get('telefones',[]):
                if item.get('is_fax'):continue
                p=clean_phone(str(item.get('ddd',''))+str(item.get('numero','')))
                if p and p not in phones:phones.append(p)
            email=str(d.get('email') or '').lower(); domain=email.split('@')[-1] if '@' in email else ''
            out={'cnpj':cnpj,'razao_social':d.get('razao_social'),'telefones':phones,'dominio_cadastrado':domain,'cidade':d.get('municipio'),'uf':d.get('uf'),'url_fonte':url,'data_consulta':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(raw).hexdigest()}
            dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8');return out
        except Exception as e:
            if attempt==2:return {'cnpj':cnpj,'erro':str(e),'url_fonte':url,'telefones':[]}
            time.sleep(attempt+1)

def page(url,cnpj):
    raw,final,charset=get(url)
    soup=PublicHTML();soup.feed(raw.decode(charset,errors='replace'))
    text=' '.join(soup.parts)
    ids=list(dict.fromkeys(re.sub(r'\D','',x) for x in CNPJ.findall(text)))
    same=any(x[:8]==cnpj[:8] for x in ids)
    phones=[];contexts=[]
    for a in soup.links:
        href=a['href']; n=None
        if href.startswith('tel:'):n=clean_phone(href[4:])
        elif re.search(r'wa\.me/|api\.whatsapp\.com/',href):
            q=urllib.parse.parse_qs(urllib.parse.urlparse(href).query);n=clean_phone(q.get('phone',[''])[0] or href.split('wa.me/')[-1].split('?')[0])
        if n:
            pos=a['position'];context=text[max(0,pos-45):pos+160]+' '+a['label']
            if re.search(r'den[uú]ncia|[ée]tica|compliance|carreira|trabalhe conosco',context,re.I):continue
            if n not in phones:phones.append(n);contexts.append(context)
    for m in PHONE.finditer(text):
        n=clean_phone(''.join(m.groups()));context=text[max(0,m.start()-60):m.end()+70]
        if re.search(r'den[uú]ncia|[ée]tica|compliance|carreira|trabalhe conosco',context,re.I):continue
        if n and n not in phones:phones.append(n);contexts.append(context)
    links=[]
    for a in soup.links:
        u=urllib.parse.urljoin(final,a['href']).split('#')[0]
        if urllib.parse.urlparse(u).netloc==urllib.parse.urlparse(final).netloc and re.search(r'contato|contact|fale.conosco',u,re.I) and u not in links:links.append(u)
    return {'url':final,'titulo':' '.join(soup.title), 'cnpj_confere':same,'cnpjs_publicados':ids[:12],'telefones':phones[:12],'contextos':contexts[:12],'links_contato':links[:3],'trecho_identidade':text[:1200],'data_consulta':datetime.now(timezone.utc).isoformat()}

def site(cad):
    cnpj=cad['cnpj'];dest=ROOT/'sites'/f'{cnpj}.json'
    if dest.exists():return json.loads(dest.read_text(encoding='utf8'))
    domain=cad.get('dominio_cadastrado','')
    out={'cnpj':cnpj,'dominio':domain,'paginas':[]}
    if domain and domain not in FREE and not BAD.search(domain):
        try:
            home=page('https://'+domain,cnpj);out['paginas'].append(home)
            for u in home['links_contato'][:2]:
                try:out['paginas'].append(page(u,cnpj))
                except Exception as e:out.setdefault('erros',[]).append(str(e))
        except Exception as e:out['erro']=str(e)
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8');return out

def main():
    origin=json.loads((ROOT/'origem_atual.json').read_text(encoding='utf8'))
    ids=[re.sub(r'\D','',r[1]) for r in origin[1:]];assert len(set(ids))==228
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:
        cad=list(p.map(cadastro,ids))
    (ROOT/'cadastros.json').write_text(json.dumps(cad,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'fase':'cadastro','consultados':len(cad),'com_telefone':sum(bool(d.get('telefones')) for d in cad),'erros':sum(bool(d.get('erro')) for d in cad)},ensure_ascii=True),flush=True)
    sites=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as p:
        fs={p.submit(site,d):d['cnpj'] for d in cad}
        for f in concurrent.futures.as_completed(fs):
            sites.append(f.result())
            if len(sites)%30==0:print('Sites conferidos',len(sites),'de',len(cad),flush=True)
    (ROOT/'sites.json').write_text(json.dumps(sites,ensure_ascii=False,indent=2),encoding='utf8')
    summary=[]
    for s in sites:
        for pg in s['paginas']:
            if pg['telefones']:
                summary.append({'cnpj':s['cnpj'],'url':pg['url'],'titulo':pg['titulo'],'confere':pg['cnpj_confere'],'telefones':pg['telefones'][:3],'contextos':pg['contextos'][:3]})
    (ROOT/'candidatos_sites.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'fase':'sites','paginas_com_telefone':len(summary),'cnpjs_com_site_telefone':len({d['cnpj'] for d in summary}),'cnpjs_com_identidade_confirmada':len({d['cnpj'] for d in summary if d['confere']})}),flush=True)

if __name__=='__main__':main()
