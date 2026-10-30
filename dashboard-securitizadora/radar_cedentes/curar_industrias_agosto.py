"""Classifica a cópia pública atual da planilha, sem editar a fonte."""
import concurrent.futures, hashlib, json, re, threading, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent / 'data' / 'curadoria_industrias'
LOCK = threading.Lock()
NEXT = 0.0

def consulta(cnpj):
    global NEXT
    dest = ROOT / 'cadastro' / (cnpj + '.json')
    for p in [dest, ROOT.parent / 'industrias' / 'cadastro' / (cnpj + '.json')]:
        if p.exists():
            d = json.loads(p.read_text(encoding='utf8'))
            if d.get('cnae_principal') and re.sub(r'\D', '', d['cnpj']) == cnpj:
                return d
    url = 'https://api.opencnpj.org/' + cnpj
    for attempt in range(4):
        with LOCK:
            pause = max(0, NEXT - time.monotonic())
            NEXT = max(NEXT, time.monotonic()) + .26
        if pause: time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=25) as response: raw = response.read()
            d = json.loads(raw)
            assert re.sub(r'\D', '', d['cnpj']) == cnpj, 'CNPJ diferente'
            out = {k: d.get(k) for k in ['cnpj','razao_social','cnae_principal','cnaes_secundarios','natureza_juridica','situacao_cadastral']}
            out.update(url_cadastro=url, data_consulta=datetime.now(timezone.utc).isoformat(), sha256=hashlib.sha256(raw).hexdigest())
            assert out['cnae_principal'], 'CNAE ausente'
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf8')
            return out
        except Exception as e:
            if attempt == 3: return {'cnpj': cnpj, 'erro': str(e)}
            time.sleep(2 * (attempt + 1))

def main():
    rows = json.loads((ROOT / 'source_rows.json').read_text(encoding='utf8'))
    ids = list(dict.fromkeys(re.sub(r'\D', '', str(r[1])) for r in rows[6:] if r[1]))
    assert all(len(x) == 14 for x in ids)
    print('CNPJs para conferir:', len(ids), flush=True)
    cadastros = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        fs = {pool.submit(consulta, c): c for c in ids}
        for f in concurrent.futures.as_completed(fs):
            c = fs[f]; cadastros[c] = f.result()
            if len(cadastros) % 50 == 0: print('Conferidos', len(cadastros), 'de', len(ids), flush=True)
    decisions = []
    for i, r in enumerate(rows[6:], 7):
        if not r[1]: continue
        c = re.sub(r'\D', '', str(r[1])); d = cadastros[c]
        code = re.sub(r'\D', '', str(d.get('cnae_principal') or ''))
        division = int(code[:2]) if len(code) == 7 else None
        include = division is not None and 10 <= division <= 32
        reason = 'CNAE principal industrial (divisões 10 a 32)' if include else ('Consulta pendente' if not code else 'Atividade principal fora da fabricação (divisões 10 a 32)')
        decisions.append({'linha_original':i,'cnpj':c,'nome_original':r[2],'incluir':include,'motivo':reason,'cadastro':d})
    (ROOT / 'classificacao.json').write_text(json.dumps(decisions, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'linhas':len(decisions),'industrias':sum(d['incluir'] for d in decisions),'erros':sum(bool(d['cadastro'].get('erro')) for d in decisions)}, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()
