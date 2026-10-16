import csv
import concurrent.futures
import io
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path('radar_cedentes/data/ots')
root.mkdir(parents=True,exist_ok=True)
def download(year):
    url=f'https://dados.cvm.gov.br/dados/SECURIT/DOC/INF_MENSAL_OTS/DADOS/inf_mensal_ots_{year}.zip'
    path=root/f'inf_mensal_ots_{year}.zip'
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=45).read())
    layout=[]
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            raw=z.read(name)
            try:
                text=raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                text=raw.decode('latin1')
            reader=csv.DictReader(io.StringIO(text),delimiter=';')
            rows=list(reader)
            layout.append({'arquivo':name,'campos':reader.fieldnames,'registros':len(rows),'exemplo':rows[:1]})
            (root/(name+'.json')).write_text(json.dumps(rows,ensure_ascii=False),encoding='utf8')
    (root/f'layout_{year}.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf8')
    print(year,[(r['arquivo'],r['registros']) for r in layout],flush=True)
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        list(ex.map(download,[2023,2024,2025,2026]))
