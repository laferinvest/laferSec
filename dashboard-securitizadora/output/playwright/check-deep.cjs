const fs=require('node:fs');
const cp=require('node:child_process');
const {createRequire}=require('node:module');
const req=createRequire('C:/Users/danie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=req('playwright');
(async()=>{
const server=cp.spawn('C:/Program Files/nodejs/node.exe',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5182'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const mock=fs.readFileSync('output/playwright/mock-data.js','utf8');
await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();if(u.pathname==='/src/supabaseClient.js')return route.fulfill({contentType:'application/javascript',body:mock});return route.continue();});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
let loaded=false;for(let attempt=0;attempt<20;attempt++){try{await page.goto('http://127.0.0.1:5182');loaded=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!loaded)throw new Error('Preview unavailable');
await page.getByRole('button',{name:'Patrimônio',exact:true}).waitFor();
const audits=[];const audit=async(name)=>{const result=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));audits.push({name,...result});console.log(name+' '+JSON.stringify(result));await page.screenshot({path:'output/playwright/'+name+'.png',fullPage:true});};
for(const width of [320,390,768]){
await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Análise Aprofundada',exact:true}).click();await page.getByRole('button',{name:'Riscos e Alertas',exact:true}).click();await page.locator('.risk-subnav').waitFor();
for(const name of ['Visão Geral','Limites e Alertas','Rating Interno']){await page.locator('.risk-subnav').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(150);await audit('risk-'+width+'-'+name.replaceAll(' ','-'));}
await page.locator('.risk-subnav').getByRole('button',{name:'Limites e Alertas',exact:true}).click();await page.getByRole('button',{name:'Configurar limites',exact:true}).click();await audit('limits-dialog-'+width);await page.locator('.risk-modal').getByRole('button',{name:'Cancelar',exact:true}).click();
await page.getByRole('button',{name:'Árvore de Cedentes',exact:true}).click();await page.getByRole('button',{name:'Adicionar cedente',exact:true}).click();await page.getByRole('combobox',{name:'Cedente da carteira',exact:true}).fill('sao jose');const count=await page.getByRole('option').count();console.log('wizardMatches '+count);await page.getByRole('combobox',{name:'Cedente da carteira',exact:true}).press('Enter');await page.getByRole('radio',{name:/Um sacado específico/}).check();await page.getByRole('combobox',{name:'Sacado do cedente',exact:true}).fill('sao paulo');console.log('wizardBuyers '+await page.getByRole('option').count());await audit('wizard-search-'+width);await page.getByRole('combobox',{name:'Sacado do cedente',exact:true}).press('Enter');await page.getByRole('button',{name:'Continuar →',exact:true}).click();await audit('wizard-family-'+width);await page.getByRole('button',{name:'Fechar cadastro',exact:true}).click();
}
console.log(JSON.stringify({audits,errors}));fs.writeFileSync('output/playwright/deep-report.json',JSON.stringify({audits,errors},null,2));
}finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});