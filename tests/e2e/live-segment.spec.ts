import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { writeLiveTracking } from "../../src/core/live-tracking";

let f: Awaited<ReturnType<typeof executionFixture>>, execution: Awaited<ReturnType<typeof readDriverExecution>>;
let server:ChildProcess, origin:string;
let identity:{executionId:string;publicationRevision:number;sessionId:string}, sequence=0;
const login=randomUUID(),password=randomUUID();
test.beforeAll(async()=>{
  test.setTimeout(120000); f=await executionFixture({orderCount:6,now:new Date()}); await f.start(); await f.start(f.members[1]);
  await createUser(f.db.pool,f.actor,{name:"Segment QA",login,password});
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=10");
  execution=await readDriverExecution(f.db.pool,f.members[0].driverId,f.planId,f.timezone);
  identity={executionId:execution.id,publicationRevision:execution.publicationRevision,sessionId:randomUUID()};
  await writeLiveTracking(f.db.pool,f.members[0].authorization,f.planId,{...identity,kind:"begin"});
  const port=await freePort(); origin=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{
    windowsHide:true,stdio:"ignore",env:{...process.env,RUTAS_DATABASE_URL:f.db.config.databaseUrl,RUTAS_INSTANCE_ID:f.db.config.instanceId,
      RUTAS_BOOTSTRAP_TOKEN:f.db.config.bootstrapToken,RUTAS_APP_ORIGIN:origin,RUTAS_TIMEZONE:f.timezone,RUTAS_UNIT_PHOTO_DIR:f.photoRoot,
      RUTAS_GOOGLE_MAPS_BROWSER_KEY:"",RUTAS_GOOGLE_MAP_ID:"",RUTAS_GOOGLE_ROUTES_API_KEY:"",ODOO_URL:"",ODOO_DATABASE:"",ODOO_EMAIL:"",ODOO_API_KEY:""}});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) { try {if((await fetch(`${origin}/api/ready`)).ok)return;} catch{} await new Promise(r=>setTimeout(r,200)); }
  throw new Error("SEGMENT_SERVER_NOT_READY");
});
test.afterAll(async()=>{
  if(server?.exitCode===null) await new Promise<void>(resolve=>{server.once("exit",()=>resolve());server.kill();});
  await f?.close();
});
async function sample(index=1) {
  await writeLiveTracking(f.db.pool,f.members[0].authorization,f.planId,{...identity,kind:"sample",sequence:++sequence,
    targetStopId:execution.stops[index].id,sample:{latitude:20.64,longitude:-103.4,accuracyMeters:5,ageMilliseconds:0,mock:false}});
}
const input=()=>({executionId:execution.id,fromStopId:execution.stops[1].id,toStopId:execution.stops[4].id,fromCurrent:true});
test("real HTTP auth, role, CSRF, input contract, cache concurrency and no business mutation",async({request})=>{
  const url=`${origin}/api/live-routes/estimate`;
  expect((await request.post(url,{data:input()})).status()).toBe(401);
  expect((await request.get(url)).status()).toBe(405);
  expect((await request.post(`${origin}/api/session`,{headers:{Origin:origin},data:{login,password}})).status()).toBe(200);
  expect((await request.post(url,{headers:{Origin:"https://foreign.invalid"},data:input()})).status()).toBe(403);
  for(const data of [{...input(),fromCurrent:"true"},{...input(),latitude:20},{...input(),executionId:"invalid"}])
    expect((await request.post(url,{headers:{Origin:origin},data})).status()).toBe(400);
  await sample(); const before=await readDriverExecution(f.db.pool,f.members[0].driverId,f.planId,f.timezone);
  const responses=await Promise.all(Array.from({length:6},()=>request.post(url,{headers:{Origin:origin},data:input()})));
  for(const response of responses){expect(response.status()).toBe(200);expect(response.headers()["cache-control"]).toContain("no-store");expect(await response.json()).toMatchObject({totalSeconds:1800,positions:[2,3,4,5]});}
  const after=await readDriverExecution(f.db.pool,f.members[0].driverId,f.planId,f.timezone);
  expect({...after,serverTime:before.serverTime}).toEqual(before);
  const settlementLogin=randomUUID(); await createUser(f.db.pool,f.actor,{login:settlementLogin,name:"Settlement QA",password,role:"settlement"});
  await request.post(`${origin}/api/session`,{headers:{Origin:origin},data:{login:settlementLogin,password}});
  expect((await request.post(url,{headers:{Origin:origin},data:input()})).status()).toBe(403);
});
test("clocks follow actual stop changes, keyboard/static mode, mobile fit and GPS recovery",async({page})=>{
  test.setTimeout(90000); await sample();
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.request.post(`${origin}/api/session`,{headers:{Origin:origin},data:{login,password}});
  await page.setViewportSize({width:1510,height:820});await page.goto(origin);
  await page.getByRole("button",{name:"Ruta en vivo",exact:true}).click();
  await page.getByLabel("Chofer",{exact:true}).selectOption(f.members[0].driverId);
  await page.getByRole("button",{name:"Ver avance",exact:true}).click();
  const panel=page.getByRole("complementary",{name:"Avance de los choferes"});
  const clock=(n:number)=>panel.getByRole("button",{name:`Seleccionar parada ${n} para estimar tiempo`,exact:true});
  await clock(2).focus();await page.keyboard.press("Enter");await clock(5).click();
  const readout=panel.getByLabel("Tiempo estimado entre paradas");
  await expect(readout).toContainText("Desde ahora · Parada 2 → 5: ≈30 min");
  await expect(page.getByLabel("Resumen de tiempo entre paradas")).toContainText("2 → 5: ≈30 min");
  expect(await panel.locator(".live-selected-stop").count()).toBe(0);
  await sample(2);await page.getByRole("button",{name:"Actualizar",exact:true}).click();
  await expect(readout).toContainText("Desde ahora · Parada 3 → 5: ≈20 min");
  await expect(clock(3)).toHaveAttribute("aria-pressed","true");await clock(3).click();await expect(readout).toHaveCount(0);
  await sample(1);await page.getByRole("button",{name:"Actualizar",exact:true}).click();
  await clock(5).click();await clock(3).click();
  await expect(readout).toContainText("Al salir · Parada 3 → 5: ≈10 min");
  await page.setViewportSize({width:375,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  for(const row of await panel.locator(".live-stop-row").all()) expect(await row.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await mkdir(".local/qa/live-segment",{recursive:true});await page.screenshot({path:".local/qa/live-segment/mobile.png"});
  await panel.getByRole("button",{name:"Quitar consulta de tiempo"}).click();await clock(2).click();await clock(5).click();
  await f.db.pool.query("UPDATE route_live_tracking SET observed_at=now()-interval '31 seconds' WHERE execution_id=$1",[execution.id]);
  await page.getByRole("button",{name:"Actualizar",exact:true}).click();
  await expect(readout).toContainText("ubicación reciente");await expect(readout).not.toContainText("≈30 min");
  await sample();await page.getByRole("button",{name:"Actualizar",exact:true}).click();
  await expect(readout).toContainText("Desde ahora · Parada 2 → 5: ≈30 min");
  await page.setViewportSize({width:1510,height:820});await page.screenshot({path:".local/qa/live-segment/desktop.png"});
  await page.getByLabel("Chofer",{exact:true}).selectOption(f.members[1].driverId);
  await expect(page.getByLabel("Resumen de tiempo entre paradas")).toHaveCount(0);expect(errors).toEqual([]);
});
test("four control screens retain independent selections and do not reorder stops",async({page})=>{
  await sample();const gridLogin=randomUUID();await createUser(f.db.pool,f.actor,{login:gridLogin,name:"Grid QA",password});
  await page.request.post(`${origin}/api/session`,{headers:{Origin:origin},data:{login:gridLogin,password}});
  const screens=Array.from({length:4},()=>({id:randomUUID(),type:"routes",driverId:f.members[0].driverId,vehicleId:""}));
  expect((await page.request.put(`${origin}/api/control-center`,{headers:{Origin:origin},data:{expectedVersion:0,screens}})).status()).toBe(200);
  await page.setViewportSize({width:1500,height:1000});await page.goto(origin);
  await page.getByRole("button",{name:"Centro de control",exact:true}).click();
  const cards=page.locator(".control-grid > .control-screen");await expect(cards).toHaveCount(4);
  for(const [index,from] of [2,3].entries()) {
    const card=cards.nth(index);await card.getByRole("button",{name:"Ver avance",exact:true}).click();
    await card.getByRole("button",{name:`Seleccionar parada ${from} para estimar tiempo`,exact:true}).click();
    await card.getByRole("button",{name:"Seleccionar parada 5 para estimar tiempo",exact:true}).click();
    await expect(card.getByLabel("Tiempo estimado entre paradas")).toContainText(`Parada ${from} → 5`);
  }
  await expect(cards.nth(0).getByLabel("Resumen de tiempo entre paradas")).toContainText("2 → 5");
  await expect(cards.nth(1).getByLabel("Resumen de tiempo entre paradas")).toContainText("3 → 5");
  await expect(cards.nth(2).getByLabel("Resumen de tiempo entre paradas")).toHaveCount(0);
  await mkdir(".local/qa/live-segment",{recursive:true});await page.screenshot({path:".local/qa/live-segment/four-screens.png"});
});
