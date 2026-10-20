const fs=require('node:fs');
const cp=require('node:child_process');
const {createRequire}=require('node:module');
const req=createRequire('C:/Users/danie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=req('playwright');
(async()=>{
const server=cp.spawn('C:/Program Files/nodejs/node.exe',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5180'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const mock=fs.readFileSync('output/playwright/mock-data.js','utf8');
await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();if(u.pathname==='/src/supabaseClient.js')return route.fulfill({contentType:'application/javascript',body:mock});return route.continue();});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
let loaded=false;for(let attempt=0;attempt<20;attempt++){try{await page.goto('http://127.0.0.1:5180');loaded=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!loaded)throw new Error('Preview unavailable');
await page.getByRole('button',{name:'Patrimônio',exact:true}).waitFor();
const tabs=['Patrimônio','Resumo Matinal','Operações e Recebíveis','Carteira e Concentração','Análise Aprofundada','Atualizar Base de Dados','Análise de NF'];
const results=[];const save=()=>fs.writeFileSync('output/playwright/mobile-report.json',JSON.stringify({results,errors},null,2));
for(const width of [320,390,768,1024,1440]) {
await page.setViewportSize({width,height:844});
for(const tab of tabs){await page.getByRole('button',{name:tab,exact:true}).click();await page.waitForTimeout(450);
const audit=await page.evaluate((w)=>{return {width:w,layoutWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(el).position==='fixed')return false;let p=el.parentElement;while(p&&p!==document.body){if(['auto','scroll','hidden'].includes(getComputedStyle(p).overflowX))return false;p=p.parentElement;}return r.right>w+2||r.left< -2;}).slice(0,12).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,55),width:el.getBoundingClientRect().width}))};},width);
results.push({tab,...audit});save();console.log(width+" "+tab+" "+audit.scrollWidth);if(width===390)await page.screenshot({path:'output/playwright/'+tabs.indexOf(tab)+'-final-390.png',fullPage:true});
}
}
await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Operações e Recebíveis',exact:true}).click();await page.getByRole('button',{name:'Abrir filtros',exact:true}).click();
const cedente=page.getByRole('combobox',{name:'Digite o cedente…'});await cedente.fill('sao jose');const matches=await page.getByRole('option').count();await cedente.press('Enter');await page.waitForTimeout(150);const selection=await cedente.inputValue();console.log(JSON.stringify({matches,selection,aside:await page.locator('#analysis-filters').innerText()}));await page.screenshot({path:'output/playwright/search-final.png'});
await page.setViewportSize({width:390,height:460});await page.waitForTimeout(200);const keyboardKeepsFilters=await page.locator('#analysis-filters').evaluate(el=>!el.inert&&getComputedStyle(el).visibility!=='hidden');
await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Limpar Nomes',exact:true}).click();
const group=page.getByRole('combobox',{name:'Grupo Econômico',exact:true});await group.fill('sao');const groupMatches=await page.getByRole('option').count();await group.press('Enter');const groupSelection=await group.inputValue();
await page.getByRole('button',{name:'Limpar Grupo Econômico'}).click();
const sacado=page.getByRole('combobox',{name:'Digite o sacado…'});await sacado.fill('sao paulo');const buyerMatches=await page.getByRole('option').count();await sacado.press('Enter');const buyerSelection=await sacado.inputValue();
await page.screenshot({path:'output/playwright/filters-final-390.png',fullPage:true});
fs.writeFileSync('output/playwright/mobile-report.json',JSON.stringify({results,search:{matches,selection,groupMatches,groupSelection,buyerMatches,buyerSelection,keyboardKeepsFilters},errors},null,2));
console.log(JSON.stringify({results,search:{matches,selection,groupMatches,groupSelection,buyerMatches,buyerSelection,keyboardKeepsFilters},errors},null,2));
}finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});