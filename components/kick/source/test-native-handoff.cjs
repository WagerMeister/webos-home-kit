'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'service/browser-session.js'),'utf8');
async function scenario(sequence){
 let calls=0,cancelled=false,cancelRequests=0;
 const fakeFs={statSync:()=>({size:2}),readFileSync:()=>'{}',openSync:()=>3,writeSync:(fd,data)=>{cancelled=JSON.parse(data).cancelled===true;},fsyncSync(){},closeSync(){},renameSync(){},unlinkSync(){},fchownSync(){}};
 const http={request(options,callback){cancelRequests++;const req=new EventEmitter();req.setTimeout=()=>{};req.abort=()=>{};req.end=()=>setImmediate(()=>callback({resume(){},on(event,fn){if(event==='end')setImmediate(fn);}}));return req;}};
 const sandbox={module:{exports:{}},require:name=>name==='fs'?fakeFs:name==='http'?http:require(name),__dirname:'/private/test',process,setTimeout:(fn,ms)=>setTimeout(fn,ms===250||ms===100?1:ms),clearTimeout};
 vm.runInNewContext(source,sandbox);
 const handlers={};const service={register(name,handler){handlers[name]=handler;},call(uri,payload,callback){assert.match(uri,/hbchannel.service\/exec$/);const appId=sequence[Math.min(calls++,sequence.length-1)];setImmediate(()=>callback({payload:{returnValue:true,stdoutString:JSON.stringify({appId})}}));}};
 sandbox.module.exports.register(service);
 await new Promise(resolve=>handlers.browserCancel({payload:{id:'a'.repeat(32),unlessBrowser:true},respond:resolve}));
 return {calls,cancelled,cancelRequests};
}
(async()=>{
 assert.deepEqual(await scenario(['com.webos.app.livetv','com.webos.app.livetv','com.jakubjirak.player']),{calls:3,cancelled:false,cancelRequests:0});
 assert.deepEqual(await scenario(['com.jakubjirak','com.jakubjirak.player']),{calls:2,cancelled:false,cancelRequests:0});
 assert.deepEqual(await scenario(['tld.my.customlauncher']),{calls:1,cancelled:true,cancelRequests:1});
 assert.deepEqual(await scenario(['com.webos.app.settings']),{calls:1,cancelled:true,cancelRequests:1});
 const expired=await scenario(['com.webos.app.livetv']);assert.equal(expired.calls,25);assert(expired.cancelled&&expired.cancelRequests===1);
 console.log('PASS: cold SAM LiveTV handoff survives, Home/other-app cancels immediately, unresolved transition expires.');
})().catch(error=>{console.error(error);process.exitCode=1;});
