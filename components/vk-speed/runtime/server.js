'use strict';
var fs=require('fs'),http=require('http'),path=require('path'),cp=require('child_process'),url=require('url'),inputLib=require('./native-input'),constants=require('constants');
var ROOT='/var/lib/webosbrew/vk-speed',STATE='/tmp/vk-speed-state',nonce=process.argv[2],port=18447,input=null,closing=false;
function diagnostic(stage,error){try{fs.writeFileSync(STATE+'/server-diag.json',JSON.stringify({stage:stage,code:error&&error.code||null}),{mode:384});}catch(e){}}
if(process.getuid()!==0||!/^[a-f0-9]{32}$/.test(nonce||''))process.exit(1);
function mono(){var t=process.hrtime();return t[0]*1000+Math.floor(t[1]/1000000);}
var lastSeen=mono(),started=lastSeen,dir=fs.lstatSync(STATE);
if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||(dir.mode&63))process.exit(1);
function uptime(){return Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0]);}
var fd=fs.openSync(STATE+'/latest.json',constants.O_RDONLY|constants.O_NOFOLLOW),st=fs.fstatSync(fd);
if(!st.isFile()||st.uid!==0||(st.mode&63)||st.size>16000)process.exit(1);
var buf=new Buffer(st.size),n=fs.readSync(fd,buf,0,st.size,0);fs.closeSync(fd);if(n!==st.size)process.exit(1);
var state=JSON.parse(buf.toString('utf8')),age=uptime()-state.uptime,parsed=typeof state.source==='string'?url.parse(state.source):{};
if(age<0||age>20||typeof state.source!=='string'||state.source.length>8192||!/^(http:|https:)$/.test(parsed.protocol||'')||parsed.auth||parsed.hash||!/^(?:[a-z0-9-]+\.)*(?:okcdn\.ru|vkuser\.net|vkvideo\.ru)$/i.test(parsed.hostname||'')||['hls','mp4'].indexOf(state.format)<0||(state.format==='hls'&&!/\.m3u8$/i.test(parsed.pathname||''))||typeof state.position!=='number'||!isFinite(state.position)||state.position<0||state.position>86400)process.exit(1);
try{fs.unlinkSync(STATE+'/latest.json');}catch(e){}
diagnostic('source-accepted');
var prefix='/'+nonce+'/',app=ROOT+'/runtime/web';
var bridge=state.format==='hls'?require('./proxy').create(prefix,state.source):null;
try{fs.unlinkSync(STATE+'/diag.json');}catch(e){}
function reply(res,code,value,type){if(res.finished||res.destroyed)return;try{res.writeHead(code,{'Content-Type':type||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));}catch(e){}}
function stop(reason){if(closing)return;closing=true;if(input)input.close();function end(){if(input)input.terminate();server.close();cp.execFile('/usr/bin/python',[ROOT+'/runtime/native-mount-cleanup.py'],{timeout:3000},function(){});}if(reason==='back')cp.execFile('/usr/bin/luna-send',['-w','2500','-n','1','luna://com.webos.applicationManager/launch','{"id":"vkvideo"}'],{timeout:3500},end);else end();setTimeout(function(){process.exit(0);},7000);}
var server=http.createServer(function(req,res){
 if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!=='127.0.0.1:'+port||req.url.indexOf(prefix)!==0)return reply(res,404,{});
 var route=req.url.slice(prefix.length),uid=-1;try{uid=inputLib.clientUid(req.socket,port);}catch(e){}
 if(uid!==0&&(!input||uid!==input.uid))return reply(res,403,{});if(closing)return reply(res,410,{});lastSeen=mono();
 if(req.method==='GET'&&route==='ready')return reply(res,200,{});
 if(req.method==='GET'&&route==='session')return reply(res,200,{url:bridge?bridge.source:state.source,format:state.format,position:state.position});
 if(req.method==='GET'&&bridge&&/^media\/[a-f0-9]{24}$/.test(route))return bridge.handle(req,res,route.slice(6));
 if(req.method==='GET'&&/^(index\.html|player\.js|vendor\/hls\.light\.min\.js)$/.test(route))return fs.readFile(path.join(app,route),function(e,data){if(e)return reply(res,404,{});reply(res,200,data,/\.js$/.test(route)?'application/javascript':'text/html; charset=utf-8');});
 if(req.method!=='POST'||req.headers['x-vk-speed-session']!==nonce||String(req.headers['content-type']||'').split(';')[0]!=='application/json')return reply(res,403,{});
 var chunks=[],size=0;req.on('data',function(b){size+=b.length;if(size>4096)req.destroy();else chunks.push(b);});req.on('end',function(){var body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(e){return reply(res,400,{});}if(route==='keys'){if(!input||body.fullscreen!==true)return reply(res,403,{});return input.poll(res,function(value){reply(res,200,value);});}if(route==='progress'&&typeof body.at==='number'&&isFinite(body.at)&&typeof body.position==='number'&&isFinite(body.position)&&body.position>=0&&body.position<=86400&&[1,1.25,1.5,1.75,2].indexOf(body.rate)>=0){var d={session:nonce,at:body.at,position:body.position,rate:body.rate,paused:body.paused===true,ready:typeof body.ready==='number'?body.ready:0,fullscreen:body.fullscreen===true,focus:String(body.focus||'').slice(0,32),error:typeof body.error==='number'?body.error:0};try{fs.writeFileSync(STATE+'/diag.json',JSON.stringify(d),{mode:384});}catch(e){}return reply(res,200,{});}if(route==='finish'&&['back','hidden'].indexOf(body.reason)>=0){reply(res,200,{});return stop(body.reason);}reply(res,404,{});});
});
server.maxConnections=12;server.setTimeout(45000);server.on('error',function(e){diagnostic('http-error',e);if(input)input.close();process.exit(1);});
inputLib.prepare(function(err){if(err){diagnostic('prepare-error',err);process.exit(1);}try{input=inputLib.create(nonce,function(){stop('hidden');},function(error){if(error){diagnostic('input-error',error);process.exit(1);}server.listen(port,'127.0.0.1',function(){fs.writeFileSync(STATE+'/ready-'+nonce,'ready',{mode:384});diagnostic('ready');});});}catch(e){diagnostic('input-exception',e);process.exit(1);}});
setInterval(function(){if(mono()-lastSeen>60000||mono()-started>43200000)stop('hidden');},10000);
