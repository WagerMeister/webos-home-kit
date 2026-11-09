/* Tailscale engine. All daemon, login, route and DNS semantics stay here. */
'use strict';
module.exports = {
  id: 'tailscale', label: 'Tailscale', capabilities: {browserLogin: true},
  validateAuthURL: function(value) { return typeof value === 'string' && /^https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_-]+$/.test(value) && value.length < 512; },
  create: function(options) {
var dependencies=options.dependencies||{};
var fs=dependencies.fs||require('fs'),http=dependencies.http||require('http'),net=require('net'),cp=dependencies.cp||require('child_process'),constants=require('constants');
var timers=dependencies.timers||global,setInterval=timers.setInterval,clearInterval=timers.clearInterval,Date=dependencies.Date||global.Date,process=dependencies.process||global.process;
var ROOT=options.root,TS_SOCKET=ROOT+'/state/tailscaled.sock',config={};
Object.keys(options.settings).forEach(function(key){config[key]=options.settings[key];});
config.enabled=options.enabled===true;if(options.failure)config.failure=options.failure;
var ownProcess=options.ownProcess,log=options.log,interval=null;
var PROBE_URL=config.probeURL||'https://www.youtube.com/generate_204';
if(typeof PROBE_URL!=='string'||!/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[^\s]*$/.test(PROBE_URL))throw Error('Invalid connection probe');
var raw=null,busy=false,refreshing=false,daemon=null,up=null,lastLogin=0,lastError='',closing=false,routeReady=false,routeChecking=false,lastApply=0;
var compatReady=false,compatBusy=false,internetReady=false,probeBusy=false,lastProbe=0,connectSince=0,intentGeneration=0,autoFailed=!!config.failure;
var logFile=ROOT+'/logs/manager.log',daemonLog=ROOT+'/logs/tailscaled.log';
if(net.isIP(config.exitNodeIP)!==4||typeof config.hostname!=='string'||!/^[-a-z0-9]{1,63}$/.test(config.hostname)||config.acceptDNS!==false)throw Error('Unexpected provider configuration');
function atomicConfig(){options.onFailure(config.failure);}
function ensureDaemon(){
  var pid;try{pid=Number(fs.readFileSync(ROOT+'/state/tailscaled.pid','utf8'));}catch(error){}
  if(pid&&ownProcess(pid,'--socket='+TS_SOCKET,ROOT+'/bin/tailscaled'))return;
  var env={};Object.keys(process.env).forEach(function(k){env[k]=process.env[k];});env.GOMEMLIMIT='80MiB';
  // A regular log FD survives controller restarts; a dead parent's stdout pipe
  // could otherwise deliver SIGPIPE to Go and interrupt an established VPN.
  var output=fs.openSync(daemonLog,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,384);
  daemon=cp.spawn(ROOT+'/bin/tailscaled',['--state='+ROOT+'/state/tailscaled.state','--statedir='+ROOT+'/state','--socket='+TS_SOCKET,'--tun=tailscale0','--port=41641','--no-logs-no-support'],{cwd:ROOT,env:env,stdio:['ignore',output,output]});
  fs.closeSync(output);
  fs.writeFileSync(ROOT+'/state/tailscaled.pid',String(daemon.pid),{mode:384});
  daemon.on('error',function(){lastError='daemon_start_failed';});
  daemon.on('close',function(code){log(logFile,'tailscaled exited '+code);raw=null;daemon=null;lastError='daemon_stopped';});
}
function localStatus(done){
  var ended=false;
  function finish(error,value){if(ended)return;ended=true;done(error,value);}
  var req=http.request({socketPath:TS_SOCKET,path:'/localapi/v0/status',method:'GET',headers:{Host:'local-tailscaled.sock'}},function(res){
    var chunks=[],bytes=0;res.on('data',function(b){bytes+=b.length;if(bytes>1048576){req.abort();finish(Error('status size'));}else chunks.push(b);});
    res.on('end',function(){try{if(res.statusCode!==200)throw Error('status HTTP');finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){finish(error);}});
  });
  req.on('error',function(error){finish(error);});req.setTimeout(2500,function(){req.abort();finish(Error('status timeout'));});req.end();
}
function loginURL(){var url=raw&&raw.AuthURL;return typeof url==='string'&&/^https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_-]+$/.test(url)&&url.length<512?url:null;}
function selectedExit(){var peers=raw&&raw.Peer||{};var selected=null;Object.keys(peers).forEach(function(k){var p=peers[k];if(p.ExitNode===true&&(p.TailscaleIPs||[]).indexOf(config.exitNodeIP)>=0)selected=p;});return selected;}
function authenticated(){return raw&&['Running','Stopped','Starting','NeedsMachineAuth'].indexOf(raw.BackendState)>=0;}
function routeConfigured(){var exit=selectedExit();return !!(raw&&raw.BackendState==='Running'&&raw.Self&&raw.Self.Online===true&&exit&&exit.Online&&routeReady&&compatReady);}
function tunnelReady(){var exit=selectedExit();return !!(routeConfigured()&&Number(exit.RxBytes)>0&&typeof exit.LastHandshake==='string'&&exit.LastHandshake.indexOf('0001-')!==0);}
function usable(){return tunnelReady()&&internetReady;}
function compatibility(action,done){
  if(compatBusy)return;compatBusy=true;
  cp.execFile('/usr/bin/python',[ROOT+'/routing-compat.py',action],{timeout:4500,maxBuffer:2048},function(error){compatBusy=false;if(!error)compatReady=action==='enable';else log(logFile,'routing compatibility failed: '+action);if(done)done(error);});
}
function failOpen(reason){
  if(!config.enabled)return;config.enabled=false;config.failure=reason;autoFailed=true;lastError=reason;internetReady=false;connectSince=0;atomicConfig();log(logFile,'Connection failed; restoring normal network: '+reason);apply();
}
function checkConnectivity(){
  if(!config.enabled||!authenticated()||raw.BackendState==='NeedsMachineAuth'){connectSince=0;internetReady=false;return;}
  if(!tunnelReady())internetReady=false;
  if(routeConfigured()&&!probeBusy&&Date.now()-lastProbe>30000){
    probeBusy=true;lastProbe=Date.now();var generation=intentGeneration;
    cp.execFile('/usr/bin/curl',['-4','--connect-timeout','3','--max-time','5','--silent','--output','/dev/null','--write-out','%{http_code}',PROBE_URL],{timeout:6500,maxBuffer:1024},function(error,stdout){
      probeBusy=false;if(generation!==intentGeneration||!config.enabled)return;
      internetReady=!error&&String(stdout).trim()==='204'&&routeConfigured();
      if(internetReady){connectSince=0;lastError='';}else lastError='network_probe_failed';
    });
  }
  if(usable()){connectSince=0;lastError='';}
  else if(!connectSince)connectSince=Date.now();
  else if(Date.now()-connectSince>45000)failOpen('connection_failed_restored');
}
function publicState(includeLogin){
  var exit=selectedExit(),active=usable(),state='starting';
  if(!raw)state=lastError?'error':'starting';
  else if(raw.BackendState==='NeedsMachineAuth')state='approval';
  else if(raw.BackendState==='NeedsLogin')state=config.enabled?'login':'off-login';
  else if(!config.enabled)state=raw.BackendState==='Running'||raw.BackendState==='Starting'?'disconnecting':autoFailed?'failed':'off';
  else if(exit&&!exit.Online)state='endpoint-offline';
  else if(active)state='on';
  else if(lastError)state='error';
  else state='connecting';
  var quiescent=!!(raw&&['Stopped','NeedsLogin','NeedsMachineAuth'].indexOf(raw.BackendState)>=0&&!busy&&!compatBusy&&!compatReady&&!fs.existsSync(ROOT+'/state/routing-compat.json'));
  if(['off','failed','off-login'].indexOf(state)>=0&&!quiescent)state='disconnecting';
  var out={state:state,connected:active,authenticated:!!authenticated(),loginReady:!!loginURL(),busy:busy,quiescent:quiescent,clientVersion:'1.104.5',hostname:config.hostname,endpoint:config.exitNodeName,dnsMode:config.dnsMode,lanAllowed:true,error:lastError||null};
  if(includeLogin&&loginURL())out.authURL=loginURL();
  return out;
}
function run(args,done){
  if(busy){if(done)done(Error('busy'));return;}busy=true;lastApply=Date.now();
  up=cp.execFile(ROOT+'/bin/tailscale',['--socket='+TS_SOCKET].concat(args),{timeout:11000,maxBuffer:131072},function(error,stdout,stderr){
    busy=false;up=null;
    // A login wait timing out is expected while the owner is absent.
    if(error&&config.enabled&&!(raw&&raw.BackendState==='NeedsLogin')){lastError='client_command_failed';log(logFile,'client command failed: '+args[0]+' code='+error.code);}
    else if(!autoFailed)lastError='';
    // Once the base connection has fetched its peer map, immediately apply
    // the exit node; do not impose retry backoff on a successful first login.
    if(!error&&args[0]==='up'&&!args.some(function(arg){return arg.indexOf('--exit-node=')===0;}))lastApply=0;
    refresh();if(done)done(error);
  });
}
function upArgs(withExit){
  var args=['up','--reset','--hostname='+config.hostname,'--accept-dns=false','--accept-routes=false','--shields-up=true','--netfilter-mode=off','--timeout=8s'];
  if(withExit)args.push('--exit-node='+config.exitNodeIP,'--exit-node-allow-lan-access=true');return args;
}
function apply(){
  if(closing||busy||compatBusy||!raw)return;
  if(!config.enabled){
    if(raw.BackendState==='Running'||raw.BackendState==='Starting')run(['down']);
    else if(compatReady||fs.existsSync(ROOT+'/state/routing-compat.json'))compatibility('restore');
    return;
  }
  if(raw.BackendState==='NeedsLogin'){
    if(!loginURL()&&Date.now()-lastLogin>30000){lastLogin=Date.now();run(upArgs(false));}return;
  }
  if(raw.BackendState==='NeedsMachineAuth')return;
  // A stopped client may not have a peer map yet. Start the authenticated
  // mesh first, then resolve/select the existing exit node from Running.
  if(raw.BackendState==='Stopped'){if(Date.now()-lastApply>15000)run(upArgs(false));return;}
  if(raw.BackendState==='Running'){
    if(!compatReady){compatibility('enable',function(error){if(error)failOpen('routing_compat_failed');else apply();});return;}
    if(!selectedExit()){if(Date.now()-lastApply>15000)run(upArgs(true));return;}
    if(usable())lastError='';
  }
}
function refresh(){
  if(refreshing||closing)return;refreshing=true;
  try{
    if(fs.statSync(daemonLog).size>524288){
      var output=fs.openSync(daemonLog,constants.O_RDWR|constants.O_NOFOLLOW);
      var size=fs.fstatSync(output).size,tail=new Buffer(Math.min(size,524288));
      var count=fs.readSync(output,tail,0,tail.length,Math.max(0,size-tail.length));
      fs.writeFileSync(daemonLog+'.old',tail.slice(0,count),{mode:384});
      fs.ftruncateSync(output,0);fs.closeSync(output);
    }
  }catch(error){/* Log rotation does not affect routing. */}
  localStatus(function(error,status){
    refreshing=false;
    if(closing)return;
    if(error){raw=null;ensureDaemon();return;}
    raw=status;
    if(lastError==='daemon_stopped'||lastError==='daemon_start_failed')lastError='';
    var exit=selectedExit();
    if(raw.BackendState==='Running'&&exit&&exit.Online&&!routeChecking){
      routeChecking=true;
      cp.execFile('/sbin/ip',['-4','route','get','1.1.1.1'],{timeout:1500,maxBuffer:4096},function(error,stdout){routeChecking=false;routeReady=!error&&/\bdev tailscale0\b/.test(String(stdout));});
    }else if(raw.BackendState!=='Running'||!exit||!exit.Online)routeReady=false;
    if(raw.BackendState!=='NeedsLogin')lastLogin=0;
    apply();checkConnectivity();
  });
}
function request(action){
  if(action!=='on'&&action!=='off'&&action!=='login')throw Error('Invalid provider action');
  config.enabled=action!=='off';delete config.failure;autoFailed=false;intentGeneration++;
  internetReady=false;lastProbe=0;connectSince=0;lastError='';lastApply=0;
  if(action==='off'&&up)up.kill();
  if(action==='login')lastLogin=0;
  if(config.enabled&&raw&&raw.BackendState==='NeedsLogin'&&!busy&&(action==='on'||!loginURL())){
    raw.AuthURL='';lastLogin=Date.now();run(upArgs(false));
  }
  apply();
}
return {
  start:function(){ensureDaemon();refresh();interval=setInterval(refresh,3000);},
  request:request,
  status:publicState,
  close:function(){
    var quiescent=publicState(false).quiescent;
    closing=true;if(up)up.kill();if(interval!==null)clearInterval(interval);
    // Preserve an established connection across controller restarts. Once off,
    // release the verified old daemon so a provider switch leaves no idle client.
    if(quiescent){
      try{var pid=Number(fs.readFileSync(ROOT+'/state/tailscaled.pid','utf8'));
        if(pid&&ownProcess(pid,'--socket='+TS_SOCKET,ROOT+'/bin/tailscaled'))process.kill(pid,'SIGTERM');
      }catch(error){/* Do not target any unverified process. */}
    }
  }
};
  }
};

// Discovery is read-only. Profiles and auth state never leave the controller.
module.exports.available = function(root) {
  try {
    return ['tailscale', 'tailscaled'].every(function(name) {
      var info = require('fs').lstatSync(root + '/bin/' + name);
      return info.isFile() && info.uid === 0 && !(info.mode & 18) && !!(info.mode & 64);
    });
  } catch (error) { return false; }
};
