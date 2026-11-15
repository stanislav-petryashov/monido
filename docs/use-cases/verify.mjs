// Run after npm run build: node --import tsx docs/use-cases/verify.mjs
// Fictional fixtures only. Each case owns a new temp DATA_DIR; no existing database is opened.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright-core'
import { startServer } from '../../src/server/main.ts'
import { openDatabase } from '../../src/server/db.ts'
import { initializeSchema } from '../../src/server/schema.ts'
import { buildFamily } from '../../src/demo/family.ts'
import { writeFamily } from '../../src/server/demo/writeFamily.ts'
import { standFetch, standEnv, standCookie, STAND_MEMBERS } from '../../scripts/telegramStandLib.ts'

const caseIds=['UC-01','UC-02','UC-03','UC-04','UC-05','UC-07']
if(process.argv[2] && !caseIds.includes(process.argv[2])) throw new Error('Unknown case ID: '+process.argv[2])
const out = resolve('output/use-cases-2026-11-14')
mkdirSync(out, { recursive: true })
const now = new Date(), today = now.toISOString().slice(0, 10)
const month = offset => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7)
const end = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).toISOString().slice(0, 10)
const last = month(-1)
const report = { started: now.toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), runnerSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), untrackedSourceSha256: Object.fromEntries(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {encoding:'utf8'}).split('\0').filter(p => /\.(?:[cm]?[jt]sx?|json|sql)$/.test(p)).sort().map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])), diffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'])).digest('hex'), cases: [] }
const save = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2))
const realFetch = globalThis.fetch
const sent = []
globalThis.fetch = standFetch(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error(`External network disabled in verification: ${url.hostname}`)
  return realFetch(input, init)
}, {onSend: m => sent.push(m)})

function seed(db, id) {
  const sql = db
  sql.exec("DELETE FROM currencies WHERE code = 'EUR'; INSERT INTO members VALUES ('Alex'), ('Maria'), ('Shared'); UPDATE currencies SET inflation = 1 WHERE code = 'RUB'; INSERT INTO parameters (key,value) VALUES ('inflation_rate',10); INSERT OR REPLACE INTO app_settings VALUES ('language','en-US'), ('currency','RUB'), ('track_flows','1'), ('setup_state','done');")
  const months = Array.from({length: id === 'UC-04' ? 13 : 3}, (_,i) => month(-(id === 'UC-04' ? 13 : 3)+i))
  for (const [i,m] of months.entries()) {
    const balance = id === 'UC-04' ? 1000000 + i*50000 : 800000 + i*50000
    sql.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(end(m),'bank','Family account',balance,'RUB','Shared')
    sql.prepare('INSERT INTO monthly_cashflow VALUES (?,?,?,?,?,?,?)').run(m+'-01','Family account','Shared',200000,0,150000,'RUB')
    sql.prepare('INSERT INTO closed_months VALUES (?,?,?)').run(m, today+'T00:00:00Z','fixture')
  }
  const years = [...new Set(months.map(m=>Number(m.slice(0,4))))]
  for (const year of years) {
    const value = id === 'UC-04' ? (year === years[0] ? 10000000 : 11000000) : 5000000
    sql.prepare('INSERT INTO real_estate (name,purchase_date,purchase_price,purchase_currency,valuation_year,value,currency,member) VALUES (?,?,?,?,?,?,?,?)').run('Family apartment','2020-01-01',4000000,'RUB',year,value,'RUB','Shared')
  }
  // Exact fixture rates for every day needed by the snapshots; no live market data.
  const from = new Date(months[0]+'-01T00:00:00Z')
  for (let d = from; d <= now; d = new Date(d.getTime()+86400000)) {
    const day = d.toISOString().slice(0,10)
    const rate = id === 'UC-04' && d.getUTCFullYear() === years[0] ? 80 : 100
    sql.prepare('INSERT INTO fx_rates VALUES (?,?,?,?)').run(day,'RUB',rate,day)
  }
  if (id === 'UC-01') sql.prepare('INSERT INTO loans (name,issue_date,principal,rate,term_months,monthly_payment,currency,member,type,status) VALUES (?,?,?,?,?,?,?,?,?,?)').run('Family loan',last+'-01',1200000,0,120,10000,'RUB','Alex','consumer','active')
  if (id === 'UC-05') sql.prepare('INSERT INTO goals VALUES (?,?,?,?,?,?,?)').run('holiday','Family trip',600000,0,month(12)+'-01','✈️','RUB')
  return { months, last, income:200000, expense:150000, saving:50000 }
}

let browser
try {
  browser = await chromium.launch({channel:'chrome', headless:true})
  for (const id of caseIds) {
    if (process.argv[2] && process.argv[2] !== id) continue
    const result = {id, checks:[], errors:[], dataDir:mkdtempSync(join(tmpdir(), `ff-${id}-`))}
    report.cases.push(result)
    result.runtime=process.version
    let server, context, db
    const check = async (name, fn) => {
      try { await fn(); result.checks.push({name,status:'PASS'}) }
      catch(e) { result.checks.push({name,status:'FAIL',error:String(e)}); console.error(id,name,String(e)) }
    }
    try {
      let auth, ids
      if (id === 'UC-07') {
        const d = openDatabase(join(result.dataDir,'finance.sqlite'))
        initializeSchema(d,resolve('schema.sql'))
        assert.equal(d.sqlite.prepare('SELECT count(*) n FROM assets').get().n,0)
        writeFamily(d.sqlite,buildFamily({today}))
        ids = STAND_MEMBERS.slice(0,2).map(m => {
          d.sqlite.prepare('UPDATE users SET telegram_id = ? WHERE member = ?').run(m.telegramId,m.member)
          return Number(d.sqlite.prepare('SELECT id FROM users WHERE member = ?').get(m.member).id)
        })
        d.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auth_mode', 'telegram')")
        d.close()
        server = await startServer({...standEnv(result.dataDir),PORT:'0'}, a=>auth=a)
      } else {
        server = await startServer({DATA_DIR:result.dataDir,HOST:'127.0.0.1',PORT:'0',UPDATE_CHECK:'off'})
        db = new DatabaseSync(join(result.dataDir,'finance.sqlite'))
        assert.equal(db.prepare('SELECT count(*) n FROM assets').get().n,0)
        result.fixture = seed(db,id)
      }
      result.checks.push({name:'Separate empty installation initialized',status:'PASS'})
      const base = `http://127.0.0.1:${server.port}`
      if (id !== 'UC-07') {
        const setup = await fetch(`${base}/api/auth/bootstrap`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'password',password:'use-cases-fixture'})})
        assert.equal(setup.status,200)
      }
      context = await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'})
      context.setDefaultTimeout(10000)
      context.setDefaultNavigationTimeout(15000)
      await context.tracing.start({screenshots:true,snapshots:true})
      const page = await context.newPage()
      page.on('pageerror', e=>result.errors.push(String(e)))
      if (id === 'UC-07') {
        const cookie = await standCookie(auth,ids[0])
        await context.addCookies([{name:'session',value:cookie.split(';')[0].slice('session='.length),url:base}])
      } else {
        const login = await context.request.post(base+'/api/auth/login',{data:{password:'use-cases-fixture'},headers:{Origin:base}})
        assert.equal(login.status(),200, await login.text())
      }
      const api = async (path, method='GET', body) => {
        const res = await context.request.fetch(base+path,{method,data:body,headers:{Origin:base}})
        const data = await res.json()
        assert.ok(res.ok(),`${method} ${path}: ${res.status()} ${JSON.stringify(data)}`)
        return data
      }
      const shot = async (path, name) => {
        await page.goto(base+path,{waitUntil:'networkidle'})
        await page.locator('h1').waitFor()
        if(page.viewportSize().width>=1200) assert.ok((await page.locator('.shell__main').boundingBox()).width>900,'Desktop content must remain readable beside the sidebar')
        await page.evaluate(()=>document.fonts.ready)
        save(`${id}-${name}-layout.json`,await page.evaluate(()=>{
          const el=document.querySelector('.sidebar'), main=document.querySelector('.shell__main');
          return {width:innerWidth,ua:navigator.userAgent,sidebar:el?.getBoundingClientRect().toJSON(),main:main?.getBoundingClientRect().toJSON(),variable:el&&getComputedStyle(el).getPropertyValue('--sidebar-w'),computedWidth:el&&getComputedStyle(el).width,rootFont:getComputedStyle(document.documentElement).fontSize}
        }))
        writeFileSync(join(out,`${id}-${name}.txt`),await page.locator('body').innerText())
        // Viewport captures preserve the sticky shell; full-page capture distorts it in Chrome 157.
        await page.screenshot({path:join(out,`${id}-${name}.png`),fullPage:false,animations:'disabled'})
      }
      let s = await api('/api/snapshot?currency=RUB')
      save(`${id}-snapshot.json`,s)
      const closeTo = (a,b) => assert.ok(Math.abs(a-b)<0.02,`${a} != ${b}`)
      if (id === 'UC-01') {
        await check('Assets 5.9m minus debt 1.2m = net worth 4.7m RUB',()=>{closeTo(s.capital.assets,5900000);closeTo(s.capital.liabilities,1200000);closeTo(s.capital.netWorth,4700000)})
        await shot('/','overview');await check('Overview displays net worth 4.7m RUB',async()=>assert.match(await page.locator('body').innerText(),/4,700,000/)); await shot('/assets','assets'); await shot('/loans','loans')
        await check('Short history does not fabricate annual growth beyond savings',()=>assert.equal(s.growthBeyondSavings.annualRate,null))
      }
      if (id === 'UC-02') {
        await check('Historical monthly surplus 50,000 RUB and savings rate 25%',()=>{closeTo(s.cashflow.closedMonth.income,200000);closeTo(s.cashflow.closedMonth.expense,150000);closeTo(s.cashflow.savingsRatePct,25);closeTo(s.cashflow.avg3m.netPerMonth,50000)})
        await shot('/cashflow','cashflow');await check('Cashflow displays income, expenses and savings',async()=>{const text=await page.locator('body').innerText();for(const value of ['200,000','150,000','50,000']) assert.ok(text.includes(value),value)}); await shot('/','overview')
        await api('/api/settings','PUT',{trackFlows:false})
        const off=await api('/api/snapshot?currency=RUB')
        await check('Turning flows off hides calculations instead of zero',()=>{assert.equal(off.trackFlows,false);assert.equal(off.cashflow.closedMonth,null);assert.equal(off.cashflow.savingsRatePct,null)})
        await shot('/cashflow','flows-off');await check('UI explains disabled cashflow tracking',async()=>assert.match(await page.locator('body').innerText(),/tracking.*off|track.*income|tracking.*disabled/i))
        await api('/api/settings','PUT',{trackFlows:true})
        const restored=await api('/api/snapshot?currency=RUB')
        await check('Turning flows back on preserves history',()=>closeTo(restored.cashflow.closedMonth.income,200000))
      }
      if (id === 'UC-03') {
        await shot('/available-money','unconfirmed')
        result.assessment = {month:last,name:'Family account',member:'Shared',currency:'RUB',balance:900000,available:true,reserve:900000,goals:0,commitments:0}
        await page.getByRole('button',{name:'Confirm Family account',exact:true}).click()
        await page.getByRole('button',{name:'Available at once',exact:true}).click()
        await page.getByRole('textbox',{name:'Cushion (RUB)',exact:true}).fill('900000')
        await page.getByRole('button',{name:new RegExp('^Confirm '+new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(new Date(last+'-01'))+'$')}).click()
        await page.getByText('6 mo of expenses · goal 6 mo',{exact:true}).waitFor()
        result.checks.push({name:'Reserve confirmed through browser and shows six months',status:'PASS'})
        await shot('/available-money','confirmed')
        await check('Reserve confirmation persists on server',async()=>{const a=await api('/api/availability');assert.equal(a.assessments[0].reserve,900000)})
        await check('Bank coverage is 6 months, property excluded',()=>closeTo(s.cashflow.emergencyMonths,6))
        const bad = await context.request.put(base+'/api/availability',{headers:{Origin:base},data:{...result.assessment,reserve:900001}})
        await check('Cannot earmark more than balance',()=>assert.equal(bad.status(),400))
      }
      if (id === 'UC-04') {
        const usd=await api('/api/snapshot?currency=USD');save(`${id}-usd.json`,usd)
        await check('RUB capital grows 11m → 12.6m',()=>{closeTo(s.history[0].netWorth,11000000);closeTo(s.capital.netWorth,12600000)})
        await check('USD capital falls 137,500 → 126,000',()=>{closeTo(usd.history[0].netWorth,137500);closeTo(usd.capital.netWorth,126000)})
        await check('Contributions 600,000 and growth beyond them 1m RUB',()=>{closeTo(s.growthBeyondSavings.savingsTotal,600000);closeTo(s.growthBeyondSavings.growthAmount,1000000)})
        await shot('/','rub-overview');await shot('/assets','rub-assets');await shot('/health','health')
        await page.goto(base+'/assets',{waitUntil:'networkidle'})
        await page.getByRole('button',{name:'Year',exact:true}).click()
        await page.screenshot({path:join(out,`${id}-rub-year.png`),fullPage:false,animations:'disabled'})
        await Promise.all([page.waitForResponse(r=>r.url().includes('/api/snapshot') && r.url().includes('USD')),page.getByRole('button',{name:'USD',exact:true}).click()])
        await page.waitForFunction(()=>document.body.innerText.includes('126,000') && getComputedStyle(document.querySelector('.page-enter')).opacity==='1')
        await check('Year view displays USD decline of 11,500',async()=>assert.match(await page.locator('body').innerText(),/11,500/))
        writeFileSync(join(out,`${id}-usd-year.txt`),await page.locator('body').innerText())
        await page.screenshot({path:join(out,`${id}-usd-year.png`),fullPage:false,animations:'disabled'})
        await check('Real RUB growth uses inflation currency independently of display currency',()=>{closeTo(s.health.metrics.real_growth_yoy.value,(12600000/11000000-1)*100-10);closeTo(usd.health.metrics.real_growth_yoy.value,s.health.metrics.real_growth_yoy.value)})
        await check('Annual rate present with twelve complete months',()=>{assert.equal(s.growthBeyondSavings.months.length,12);assert.equal(typeof s.growthBeyondSavings.annualRate,'number')})
      }
      if (id === 'UC-05') {
        await check('600,000 goal funded by 50,000 per month in twelve months',()=>{assert.equal(s.goals.plan.allocations[0].projectedDate,month(12));assert.equal(s.goals.plan.monthlySavingsBase,50000)})
        await shot('/goals','goals')
        await page.getByRole('button',{name:'Update saved',exact:true}).click()
        await page.getByRole('textbox',{name:'Amount to save',exact:true}).fill('900000')
        await page.getByRole('button',{name:'Save',exact:true}).click()
        await page.getByRole('button',{name:'Update saved',exact:true}).waitFor()
        await shot('/goals','changed-goal')
        const changed=await api('/api/snapshot?currency=RUB');save(`${id}-changed.json`,changed)
        await check('Increasing target to 900,000 delays forecast to eighteen months after UI save',()=>{assert.equal(changed.goals.plan.allocations[0].projectedDate,month(18));assert.equal(changed.goals.plan.allocations[0].status,'at_risk')})
        await shot('/goals/edit','editor')
      }
      if (id === 'UC-07') {
        const tool=async(name,body)=>(await api('/api/advisor/tools/'+name,'POST',body)).result
        const scenario={kind:'credit',amount:25000,currency:'USD',termMonths:36,ratePct:9,downPayment:0,loanType:'consumer'}
        const evaluated=await tool('evaluate_purchase',scenario);save(`${id}-credit.json`,evaluated)
        const cash=await tool('evaluate_purchase',{kind:'buy_now',amount:25000,currency:'USD'});save(`${id}-cash.json`,cash)
        await check('Cash purchase deducts 25,000 liquid funds without adding credit or changing monthly savings',()=>{const i=cash.evaluation.impact;closeTo(i.now.liquid-i.after.liquid,25000);closeTo(i.now.savingsPerMonth,i.after.savingsPerMonth);assert.equal(i.credit,null)})
        await check('Credit monthly payment agrees with independent annuity calculation',()=>{const r=.09/12;closeTo(evaluated.evaluation.impact.credit.payment,25000*r/(1-(1+r)**-36))})
        const invalid=await context.request.post(base+'/api/advisor/tools/evaluate_purchase',{headers:{Origin:base},data:{kind:'credit',amount:25000,currency:'USD'}})
        await check('Incomplete credit request rejected',()=>assert.equal(invalid.status(),400))
        const before=await api('/api/advisor/proposals');assert.equal(before.proposals.length,0)
        const preview=await tool('preview_proposal',{scenario,title:'A family car',question:'Shall we buy the family car?',verdict:{risk:evaluated.evaluation.impact.risk,recommended:null,reason:'Compare the payment with our savings and reserve'}})
        save(`${id}-preview.json`,preview)
        await check('Preview creates no proposal',async()=>assert.equal((await api('/api/advisor/proposals')).proposals.length,0))
        // Scripted consent for this fictional fixture only, not a claim that an LLM obtained consent.
        const proposal=await tool('propose_to_family',{draftId:preview.draftId});save(`${id}-proposal.json`,proposal)
        await shot('/advisor','author')
        const cookie=await standCookie(auth,ids[1]);await context.clearCookies();await context.addCookies([{name:'session',value:cookie.split(';')[0].slice(8),url:base}])
        await shot('/advisor','voter')
        result.proposalId=proposal.proposal.id
        result.versionId=proposal.proposal.current.id
        await page.getByRole('button',{name:'Agree',exact:true}).click()
        await Promise.all([page.waitForResponse(r=>r.url().includes('/votes') && r.request().method()==='POST'),page.getByRole('dialog').getByRole('button',{name:'Agree',exact:true}).click()])
        const voted=await api('/api/advisor/proposals')
        save(`${id}-voted.json`,voted)
        await check('Both family members agree, proposal accepted',()=>assert.equal(voted.proposals.find(p=>p.id===result.proposalId).status,'accepted'))
        await shot('/advisor','accepted')
        save(`${id}-mock-delivery.json`,sent)
        const authorCookie=await standCookie(auth,ids[0]);await context.clearCookies();await context.addCookies([{name:'session',value:authorCookie.split(';')[0].slice(8),url:base}])
        const duplicate=await context.request.post(base+'/api/advisor/tools/propose_to_family',{headers:{Origin:base},data:{draftId:preview.draftId}})
        await check('Used proposal draft cannot be sent twice',()=>assert.equal(duplicate.status(),404))
      }
      await page.setViewportSize({width:390,height:844}); await shot(id==='UC-07'?'/advisor':id==='UC-05'?'/goals':'/','mobile')
      await check('No horizontal page overflow at 390px',async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)))
      await check('No uncaught browser errors',()=>assert.deepEqual(result.errors,[]))
      result.status=result.checks.some(c=>c.status==='FAIL')?'FAIL':'PASS'
    } catch(e) {result.status='FAIL';result.error=String(e);console.error(id,e);if(context?.pages()[0]){writeFileSync(join(out,`${id}-error.txt`),await context.pages()[0].locator('body').innerText());await context.pages()[0].screenshot({path:join(out,`${id}-error.png`),fullPage:false,animations:'disabled'})}}
    finally {
      if(context){await context.tracing.stop({path:join(out,`${id}-trace.zip`)}).catch(()=>{});await context.close()}
      db?.close();await server?.stop();save('results.json',report)
      console.log(id,result.status)
    }
  }
} finally { await browser?.close(); globalThis.fetch=realFetch }

if (report.cases.some(c=>c.status!=='PASS')) process.exitCode=1
