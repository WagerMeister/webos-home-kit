'use strict';
var net=require('net'),cp=require('child_process'),fs=require('fs'),ROOT='/var/lib/webosbrew/tv-vpn';
var action=process.argv[2],done=false,restarted=false;
var issued=process.argv[3]===undefined?Date.now():Number(process.argv[3]);
if(!isFinite(issued)||Math.floor(issued)!==issued||issued<=0||issued>1000000000000000){process.stdout.write('{"returnValue":false,"error":"invalid_request"}\n');process.exit(1);}
if(['status','on','off','login','providers','select'].indexOf(action)<0){process.stdout.write('{"returnValue":false,"error":"invalid_action"}\n');process.exit(1);}
var provider=process.argv[4];
if(action==='select'&&(typeof provider!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(provider))){process.stdout.write('{"returnValue":false,"error":"invalid_provider"}\n');process.exit(1);}
function finish(value){if(done)return;done=true;clearTimeout(deadline);process.stdout.write(JSON.stringify(value)+'\n');}
var deadline=setTimeout(function(){finish({returnValue:false,error:'controller_unavailable'});},4500);
function connect(){
  if(done)return;
  var client=net.connect(ROOT+'/state/control.sock'),buffer='';
  client.setTimeout(4500,function(){client.destroy();finish({returnValue:false,error:'controller_unavailable'});});
  client.on('connect',function(){client.write(JSON.stringify({action:action,issued:issued,provider:provider})+'\n');});
  client.on('data',function(b){buffer+=b;if(buffer.length>4096){client.destroy();finish({returnValue:false,error:'invalid_response'});return;}if(buffer.indexOf('\n')>=0){try{finish(JSON.parse(buffer));}catch(error){finish({returnValue:false,error:'invalid_response'});}client.end();}});
  client.on('error',function(){
    if(done)return;
    if(!restarted){restarted=true;var child=cp.spawn('/usr/bin/node',[ROOT+'/manager.js'],{detached:true,stdio:'ignore'});child.on('error',function(){finish({returnValue:false,error:'controller_unavailable'});});child.unref();}
    setTimeout(connect,300);
  });
}
connect();
