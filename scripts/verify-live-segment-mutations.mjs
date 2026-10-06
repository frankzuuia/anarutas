import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mutations never touch the active checkout. Server fences use real PostgreSQL and Google.
if(process.env.RUN_SEGMENT_GOOGLE_REAL !== "1" || !process.env.RUTAS_GOOGLE_ROUTES_API_KEY)
  throw new Error("REAL_GOOGLE_CONTRACT_REQUIRED");
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const scratch=join(root,".local");await mkdir(scratch,{recursive:true});
const sandbox=await mkdtemp(join(scratch,"segment-mutants-"));
const policy="src/core/live-segment-policy.ts",google="src/core/live-segment-google.ts",service="src/core/live-segment.ts";
const unit="tests/live-segment.test.ts",integration="tests/live-segment-integration.test.ts";
const cases=[
  ["execution-isolation",policy,"route.id !== selection.executionId ||", "",unit],
  ["gps-freshness",policy,"age <= trackingPolicy.freshSeconds * 1000","true",unit],
  ["reject-revoked-gps",policy,"!location.stopped &&","",unit],
  ["skip-attended",policy,'between.filter(s => s.orders.some(o => o.status === "open"))',"between",unit],
  ["no-destination-unload",policy,"stops.slice(selection.fromCurrent ? 0 : 1, -1)","stops.slice(selection.fromCurrent ? 0 : 1)",unit],
  ["live-origin-unload",policy,"selection.fromCurrent ? 0 : 1","1",unit],
  ["remaining-unload",policy,"Math.max(0, seconds - Math.floor(elapsed / 1000))","seconds",unit],
  ["active-origin-progress",policy,"selection.fromCurrent ? activeSegmentStop(route) : selection.fromStopId","selection.fromStopId",unit],
  ["unknown-unload-warning",policy,"unknownServiceStops++; continue;","continue;",unit],
  ["google-fixed-order",google,"optimizeWaypointOrder: false","optimizeWaypointOrder: true",unit],
  ["google-waypoint-continuity",google,"i += 26","i += 27",unit],
  ["google-traffic",google,'routingPreference: "TRAFFIC_AWARE"','routingPreference: "TRAFFIC_UNAWARE"',unit],
  ["google-rounding",google,"return Math.ceil(seconds)","return Math.floor(seconds)",unit],
  ["response-context-fence",service,"current.contextKey !== result.contextKey","false",integration],
  ["evict-failed-query",service,"owned.values.delete(plan.contextKey);","void 0;",integration],
];
const results=[];
try {
  for(const path of ["src/core","tests/helpers",unit,integration,"package.json"])
    await cp(join(root,path),join(sandbox,path),{recursive:true});
  await symlink(join(root,"node_modules"),join(sandbox,"node_modules"),"junction");
  await writeFile(join(sandbox,"vitest.config.mjs"),'export default {test:{fileParallelism:false,testTimeout:30000,hookTimeout:120000}};\n');
  const originals=new Map(await Promise.all([...new Set(cases.map(c=>c[1]))].map(async path=>[path,await readFile(join(root,path),"utf8")])));
  const run=async(name,files)=>{
    const report=join(sandbox,`${name}.json`);
    const code=await new Promise((done,fail)=>{
      const child=spawn(process.execPath,[join(root,"node_modules/vitest/vitest.mjs"),"run",...files,"--reporter=json",`--outputFile=${report}`],{cwd:sandbox,windowsHide:true,stdio:"ignore"});
      child.on("error",fail);child.on("exit",done);
    });
    const summary=JSON.parse(await readFile(report,"utf8"));
    return {name,code,passed:summary.numPassedTests,failed:summary.numFailedTests};
  };
  const baseline=await run("baseline",[unit,integration]);
  if(baseline.code!==0 || baseline.passed!==19)throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
  for(const [name,path,from,to,file] of cases) {
    const original=originals.get(path);
    if(original.split(from).length!==2)throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(join(sandbox,path),original.replace(from,to));
    const result=await run(name,[file]);await writeFile(join(sandbox,path),original);
    results.push({...result,killed:result.code!==0 && result.failed>0});console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root,"reports/mutation"),{recursive:true});
  await writeFile(join(root,"reports/mutation/live-segment.json"),JSON.stringify({baseline,results},null,2));
  if(results.some(r=>!r.killed))process.exitCode=1;
} finally {
  const within=relative(scratch,sandbox);
  if(!within.startsWith("segment-mutants-")||within.includes("..")||resolve(sandbox)===resolve(scratch))throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
