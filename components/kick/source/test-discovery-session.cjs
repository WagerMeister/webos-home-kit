'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process');
const discovery=require('./service/discovery'),sessions=require('./service/browser-session');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 for(const value of [{sort:'../x'},{language:'ru&x=1'},{cursor:'a/b'},{cursor:'x'.repeat(257)},{category:-1},{category:1.2}])assert.equal(discovery.options(value),null);
 assert.equal(discovery.pathFor(discovery.options({language:'all',sort:'featured',category:15,cursor:'abc_123'})),'/api/v1/livestreams?limit=6&sort=featured&category_id=15&after=abc_123');
 let handlers={},requests=[];discovery.register({register(name,fn){handlers[name]=fn;}},{get(host,url){requests.push({host,url});return Promise.resolve(JSON.stringify({data:{livestreams:[{title:'<script>x</script>',viewer_count:12,show_view_count:false,channel:{slug:'example'},category:{id:15,name:'Category'},thumbnail:'https://images.kick.com/a.webp'},{channel:{slug:'../../evil'}},{channel:{slug:'example'}}],pagination:{next_cursor:'abc_123'}}}));},title:(a,b)=>String(a||b||'').slice(0,200),image:value=>typeof value==='string'&&value.indexOf('https://images.kick.com/')===0?value:'',respond:(message,data)=>message.respond(data),error:()=>({returnValue:false}),failure:()=>Error('invalid')});
 const invoke=(name,payload)=>new Promise(resolve=>handlers[name]({payload,respond:resolve}));
 const directory=await invoke('directory',{sort:'popular'});assert.equal(directory.items.length,1);assert.equal(directory.items[0].viewers,null);assert.equal(directory.nextCursor,'abc_123');assert.equal(requests[0].host,'web.kick.com');assert.equal((await invoke('directory',{cursor:'?inject'})).returnValue,false);
 for(const value of [null,[],{a:()=>{}}])if(value===null||Array.isArray(value))assert.equal(sessions.preferences(value),null);
 assert.equal(sessions.preferences({'kick-watched-videos':'x'.repeat(100001)}),null);
 assert(!('unrelated' in sessions.preferences({unrelated:'private'})));
 const writeDir=fs.mkdtempSync(path.join(os.tmpdir(),'kick-write-'));try{const dest=path.join(writeDir,'result.json'),valuable=path.join(writeDir,'valuable');fs.writeFileSync(valuable,'keep');fs.symlinkSync(valuable,dest+'.tmp');sessions.write(dest,{ok:true});assert.equal(fs.readFileSync(valuable,'utf8'),'keep');assert.deepEqual(JSON.parse(fs.readFileSync(dest,'utf8')),{ok:true});}finally{fs.rmSync(writeDir,{recursive:true,force:true});}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kick-sidecar-'));let child;
 try{
  const root=path.join(temp,'usr/palm'),service=path.join(root,'services/com.jakubjirak.service'),runtime=path.join(service,'.browser-runtime');fs.mkdirSync(runtime,{recursive:true});
  for(const file of ['index.js','discovery.js','browser-session.js','browser-server.js']){const source=fs.readFileSync(path.join(__dirname,'service',file),'utf8');fs.writeFileSync(path.join(service,file),file==='browser-server.js'&&process.platform!=='linux'?source.replace("configPath = '/proc/self/fd/' + directoryFd + '/' + path.basename(configPath);","configPath = path.join(path.dirname(configPath),path.basename(configPath));"):source);}
  // Exercise the HTTP/session boundary on the host; actual jailed native IPC,
  // UID authentication and read-only mounts are verified separately on the TV.
  fs.writeFileSync(path.join(service,'native-input.js'),`module.exports={prepare:cb=>cb(null),clientUid:()=>process.getuid(),create:(id,disconnected,ready)=>{setImmediate(()=>ready(null));return {uid:process.getuid(),close(){},terminate(){},poll(res,respond){respond({keys:[]});}}}};`);
  fs.mkdirSync(path.join(root,'applications'),{recursive:true});fs.symlinkSync(path.join(__dirname,'app'),path.join(root,'applications/com.jakubjirak'));
  for(let i=0;i<23;i++){const id=i.toString(16).padStart(32,'0');fs.writeFileSync(path.join(runtime,id+'.json'),'{}');fs.writeFileSync(path.join(runtime,id+'.result.json'),'{}');}
  fs.writeFileSync(path.join(runtime,'unrelated.txt'),'valuable');sessions.prune(runtime);assert.equal(fs.readdirSync(runtime).filter(x=>/^[a-f0-9]{32}\.json$/.test(x)).length,15);assert.equal(fs.readFileSync(path.join(runtime,'unrelated.txt'),'utf8'),'valuable');
  const id='a'.repeat(32),base='/'+id+'/',prefs=sessions.preferences({'kick-channel':'example','kick-speed-preference':'2'}),initial={channel:'example',video:'abc-123',position:300,rate:2};
  const config=path.join(runtime,id+'.json');fs.writeFileSync(config,JSON.stringify({id,port:18427,created:Date.now(),preferences:prefs,initial}));
  child=spawn(process.execPath,[path.join(service,'browser-server.js'),config],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>{error+=chunk;});
  function request(route,body,header=true,host='127.0.0.1:18427'){
   return new Promise((resolve,reject)=>{const data=body===undefined?null:typeof body==='string'?body:JSON.stringify(body);const req=http.request({host:'127.0.0.1',port:18427,path:base+route,method:data===null?'GET':'POST',agent:false,headers:{Host:host,...(data===null?{}:{'Content-Type':'application/json',...(header?{'X-Kick-Session':id}:{})})}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);if(data!==null)req.write(data);req.end();});
  }
  for(let i=0;i<40;i++){try{if((await request('ready')).status===200)break;}catch(e){}await wait(50);if(child.exitCode!==null)throw Error(error);}
  assert.equal((await request('ready')).status,200);
  assert.equal((await request('ready',undefined,true,'evil.test')).status,404);
  assert([403,404].includes((await request('../browser-session.js')).status));
  assert.equal((await request('index.html')).status,200);
  assert.equal((await request('sync','null')).status,400);assert.equal((await request('ready')).status,200);
  assert.equal((await request('sync','[]')).status,400);assert.equal((await request('sync','{bad}')).status,400);
  assert.equal((await request('sync',{},false)).status,403);
  assert.equal((await request('api/browserLaunch',{})).status,404);
  assert.equal(JSON.parse((await request('api/channel',{channel:'../../evil'})).text).returnValue,false);
  const changed=sessions.preferences({'kick-channel':'example','kick-speed-preference':'1.5','kick-watched-videos':'[]'});
  assert.equal((await request('sync',{preferences:changed,position:640,duration:900,rate:1.5,reason:'progress'})).status,200);
  const reload=JSON.parse((await request('session')).text);assert.equal(reload.initial.position,640);assert.equal(reload.initial.rate,1.5);assert.equal(reload.preferences['kick-speed-preference'],'1.5');
  assert.equal((await request('sync',{preferences:changed,position:650,duration:900,rate:1.5,reason:'hidden'})).status,200);
  assert.equal(JSON.parse((await request('session')).text).initial.position,650);await wait(100);assert.equal((await request('ready')).status,200);
  assert.equal((await request('cancel',{})).status,200);
  await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(Error('sidecar did not exit')),6000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(error));});});
  console.log('Discovery/session: passed (fixed host/input limits, hidden counts, pruning, real loopback assets/API, CSRF/Host/malformed input, reload state, finalization and exit).');
 }finally{if(child&&child.exitCode===null)child.kill('SIGKILL');fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
