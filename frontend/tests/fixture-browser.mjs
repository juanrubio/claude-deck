// Isolated P01 fixture UI checks. Run only through product-heavy.
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const evidence = process.env.P02_EVIDENCE_DIR
assert(evidence, 'P02_EVIDENCE_DIR is required')
await fs.mkdir(evidence, { recursive: true })
const fixtures = async name => JSON.parse(await fs.readFile(`tests/fixtures/factory/v1/${name}.json`))
const [overview, work, detail, repos, repo] = await Promise.all(['overview','work-items','work-item','repositories','repository'].map(fixtures))
const providers = ['claude-code','codex-cli','copilot-cli','opencode-cli','pi-cli'].map(id => ({ id, display_name:id, installed:true, version:'fixture', capabilities:{ config:true,plugins:true,usage:true,plans:true,sessions:true }, capability_matrix:{ config:{state:'write_capable'},plugins:{state:'write_capable'},usage:{state:'supported'} }, config_paths:{} }))
const stamp='2026-09-30T12:00:00Z'
const preset={ id:1,name:'Fixture team 1',description:'Fixture roster',created_at:stamp,updated_at:stamp,autonomy_enabled:false,slots:[1,2].map(id=>({id,preset_id:1,display_name:id===1?'Leader':'Owner',provider:'codex-cli',repo_path:'/fixture/product',role:id===1?'Leader':'Implementer',charter:'Fixture',launch_mode:'plain',launch_options:{},enabled:true,position:id-1,created_at:stamp,updated_at:stamp})) }
const requests=[], unknown=[]
function respond(req) {
 const url=new URL(req.url,'http://fixture.test'), key=url.pathname.replace('/api/v1/','')
 requests.push({path:key,method:req.method,query:Object.fromEntries(url.searchParams)})
 assert.equal(req.method,'GET','Fixture browser must never mutate')
 if(key==='factory/overview') return overview.normal.response
 if(key==='factory/work-items') { const cat=url.searchParams.get('category'); return work[cat && cat!=='all'?cat:url.searchParams.has('cursor')?'next_page':'first_page'].response }
 if(key.startsWith('factory/work-items/')) return detail.completed.response
 if(key==='factory/repositories') return repos.normal.response
 if(key.startsWith('factory/repositories/')) return repo.fresh_overlap.response
 if(key==='providers') return { providers,count:5 }
 if(key==='status') return {active_sessions:0,providers:Object.fromEntries(providers.map(p=>[p.id,p])),instance:{name:'Isolated P01 fixture',hostname:'fixture',accent:'blue'},environment:{}}
 if(key==='projects') return {projects:[],count:0}
 if(key==='agent-teams/presets') return {presets:[preset]}
 if(/agent-teams\/presets\/\d+\/github-scopes/.test(key)) return {scopes:[]}
 if(/agent-teams\/presets\/\d+\/github-work-items/.test(key)) return {items:[]}
 if(key==='agent-teams/github-recovery-gate/active') return {active:false}
 if(key.endsWith('/launch-options')) return {provider:key.split('/')[1],supported_launch_modes:['plain'],supported_launch_options:[],platform_options:[],model_options:[],reasoning_effort_options:[],context_tier_options:[],profile_options:[],warnings:[]}
 if(key==='agent-bridge/sessions') return {sessions:[],count:0}
 unknown.push(key); return null
}
const server=http.createServer(async(req,res)=>{
 try { if(req.url.startsWith('/api/v1/')) { const data=respond(req); res.writeHead(data?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(data??{detail:'No fixture for endpoint'}));return }
  let file=path.join(process.cwd(),'dist',decodeURIComponent(req.url.split('?')[0]))
  if(!file.startsWith(path.join(process.cwd(),'dist'))) throw Error('Invalid asset path')
  try { const stat=await fs.stat(file);if(!stat.isFile()) file=path.join(process.cwd(),'dist/index.html') } catch {file=path.join(process.cwd(),'dist/index.html')}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(await fs.readFile(file))
 } catch(error){ res.writeHead(500);res.end(String(error)) }
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port
const profile=await fs.mkdtemp(path.join(evidence,'chrome-profile-'))
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'})
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let ws
try {
 let debugPort
 for(let i=0;i<100;i++){try{debugPort=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await sleep(100)}}
 assert(debugPort,'Chrome debug endpoint unavailable')
 const targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 let seq=0;const pending=new Map(),errors=[]
 ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);if(data.error)p.reject(Error(JSON.stringify(data.error)));else p.resolve(data.result)}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails)}
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value
 await send('Page.enable');await send('Runtime.enable')
 const observations=[]
 for(const width of [360,768,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
  for(const [name,route,text] of [['overview','/','132 matching work'],['work','/work','Work'],['detail','/work/9','delivery and human review are unconfirmed'],['repository','/repositories/1','Same-label overlap'],['harnesses','/harnesses','Harnesses'],['unsupported','/harnesses/opencode-cli/config','Native page unavailable'],['launch','/teams/1?slot_id=1&review_launch=1','Review selected slot launch']]){
   await send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`})
   for(let i=0;i<100;i++){if(await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`))break;await sleep(50)}
   assert(await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`),`${name} did not render`)
   await sleep(100)
   const layout=await evaluate('({width:innerWidth,bodyWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector("main").clientWidth,heading:document.querySelector("main h2")?.textContent})')
   assert(layout.bodyWidth<=width,`${name} body overflow at ${width}: ${layout.bodyWidth}`)
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
   await fs.writeFile(path.join(evidence,`${name}-${width}.png`),Buffer.from(shot.data,'base64'))
   observations.push({name,route,...layout})
  }
 }
 assert.equal(errors.length,0,'Browser runtime exceptions')
 assert.equal(requests.filter(r=>r.method!=='GET').length,0)
 assert(!requests.some(r=>/operations|native_surfaces|inbox|ack|claim/.test(r.path)))
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 await fs.writeFile(path.join(evidence,'browser.json'),JSON.stringify({head,fixture_source:'eb31749bcae8f456d6df6709273afd5921d094ad',fixture_review:'59c8cc9855e1a98f7d28e16abef88171c7da69ca',manifest_sha256:'b17dea10bb7c2f9ac2047c35f5921b9adb0dacc85b71fdc700849913471d9706',observations,requests,unknown,errors},null,2))
 console.log(JSON.stringify({head,screenshots:observations.length,unknown,errors:errors.length}))
} finally { ws?.close();chrome.kill();await new Promise(resolve=>chrome.once('exit',resolve));server.close();await fs.rm(profile,{recursive:true,force:true}) }
