'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
var PORT = 18427;
var ROOT = path.join(__dirname, '.browser-runtime');
var HELPER = '/var/lib/webosbrew/kick-replay-player/v0.9.2/usr/palm/services/com.jakubjirak.service/browser-server.js';
var HOST_ROOT = '/media/developer/apps/usr/palm/services/com.jakubjirak.service/.browser-runtime';
var KEYS = ['kick-accessibility', 'kick-channel', 'kick-favorites', 'kick-quality-preference', 'kick-recent-channels', 'kick-watched-videos', 'kick-browse-mode', 'kick-speed-preference'];
function preferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  var out = {}, bytes = 0;
  for (var i = 0; i < KEYS.length; i++) {
    var key = KEYS[i], item = value[key];
    if (item === undefined || item === null) out[key] = null;
    else if (typeof item === 'string' && item.length <= 100000) { out[key] = item; bytes += Buffer.byteLength(item); }
    else return null;
  }
  return bytes <= 140000 ? out : null;
}
function file(id, suffix) { return path.join(ROOT, id + (suffix || '.json')); }
function validId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }
function read(id, suffix) {
  var name = file(id, suffix);
  if (fs.statSync(name).size > 180000) throw Error('size');
  return JSON.parse(fs.readFileSync(name, 'utf8'));
}
function write(name, value, owner) {
  var temp = name + '.tmp-' + crypto.randomBytes(16).toString('hex'), fd;
  try {
    fd = fs.openSync(temp, 'wx', 384);
    fs.writeSync(fd, JSON.stringify(value));
    if (owner && process.getuid() === 0) fs.fchownSync(fd, owner.uid, owner.gid);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, name);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) {}
  }
}
function respond(message,data){try{message.respond(data);}catch(e){/* Cancelled client. */}}
function cancelServer(id, done){
  if(!validId(id)){done();return;}
  var ended=false;function finish(){if(ended)return;ended=true;setTimeout(done,100);}
  var req=http.request({host:'127.0.0.1',port:PORT,path:'/'+id+'/cancel',method:'POST',headers:{'Content-Type':'application/json','X-Kick-Session':id}},function(res){res.resume();res.on('end',finish);});
  req.setTimeout(700,function(){req.abort();finish();});req.on('error',finish);req.end('{}');
}
function previous(done){var id;try{id=JSON.parse(fs.readFileSync(path.join(ROOT,'active.json'),'utf8')).id;}catch(e){}cancelServer(id,done);}
function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
function broker(service, command, done) {
  var ended = false, call, timer = setTimeout(function () { finish(null); }, 5000);
  function finish(data) { if (ended) return; ended = true; clearTimeout(timer); done(data); }
  try { call = service.call('luna://org.webosbrew.hbchannel.service/exec', { command: command }, function (message) {
    var p = message && message.payload; finish(p && p.returnValue === true ? String(p.stdoutString || '') : null);
  }); } catch (e) { finish(null); }
}
function foregroundId(service, done) {
  broker(service, "/usr/bin/luna-send -w 1500 -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'", function (stdout) {
    var id = null; try { id = JSON.parse(stdout).appId; } catch (e) {} done(id);
  });
}
function foreground(service, done) { foregroundId(service, function (id) { done(id === 'com.jakubjirak'); }); }
function prune(directory){
 directory=directory||ROOT;
 var names=fs.readdirSync(directory).filter(function(name){return /^[a-f0-9]{32}\.json$/.test(name);});
 names.sort(function(a,b){return fs.statSync(path.join(directory,b)).mtime.getTime()-fs.statSync(path.join(directory,a)).mtime.getTime();});
 names.slice(15).forEach(function(name){var id=name.slice(0,32);['.json','.result.json','.json.tmp','.result.json.tmp'].forEach(function(suffix){try{fs.unlinkSync(path.join(directory,id+suffix));}catch(e){}});});
}
function register(service) {
  service.register('browserReplay', function (message) {
    var p = message.payload || {}, prefs = preferences(p.preferences);
    if (!/^[a-z0-9_-]{1,25}$/.test(p.channel || '') || !/^[a-z0-9-]{1,64}$/.test(p.video || '') ||
        [1.25, 1.5, 1.75, 2].indexOf(p.rate) < 0 || typeof p.position !== 'number' || !isFinite(p.position) ||
        p.position < 0 || p.position > 2592000 || !prefs) {
      respond(message,{ returnValue: false, errorText: 'Invalid replay session.' }); return;
    }
    function start(){try {
      try { fs.mkdirSync(ROOT, 448); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      if (!fs.lstatSync(ROOT).isDirectory() || fs.lstatSync(ROOT).isSymbolicLink()) throw Error('directory');
      prune();
      var id = crypto.randomBytes(16).toString('hex');
      var config = { id: id, created: Date.now(), port: PORT, preferences: prefs,
        initial: { channel: p.channel, video: p.video, position: p.position, rate: p.rate } };
      write(file(id), config);
      // The SDK service is jailed. Execute only our reviewed, root-private helper;
      // neither the command nor executable path comes from an app request.
      broker(service, 'LD_PRELOAD= /usr/bin/setsid /usr/bin/node ' + quote(HELPER) + ' ' +
        quote(HOST_ROOT + '/' + id + '.json') + ' </dev/null >/dev/null 2>&1 &', function () {});
      var start = Date.now(), finished = false;
      var finish=function(ok) { if (finished) return; finished = true; try { respond(message,ok ? { returnValue: true, id: id } : { returnValue: false, errorText: 'The replay player could not start.' }); } catch (e) { /* Closed app. */ } };
      var ready=function() {
        var request = http.get({ host: '127.0.0.1', port: PORT, path: '/' + id + '/ready' }, function (res) {
          res.resume(); if (res.statusCode === 200) finish(true); else retry();
        });
        request.setTimeout(600, function () { request.abort(); }); request.on('error', retry);
      };
      var retry=function() { if (finished) return; if (Date.now() - start > 6500) finish(false); else setTimeout(ready, 120); };
      ready();
    } catch (e) { respond(message,{ returnValue: false, errorText: 'The replay player could not start.' }); }}
    foreground(service, function(ok){if(!ok){respond(message,{returnValue:false});return;}previous(start);});
  });
  service.register('browserLaunch', function (message) {
    var id = message.payload && message.payload.id;
    try {
      if (!validId(id)) throw Error('id');
      var config = read(id); if (Date.now() - config.created < 0 || Date.now() - config.created > 120000) throw Error('expired');
      foreground(service, function(visible){
      var cancelled=true;try{cancelled=read(id).cancelled===true;}catch(e){}
      if(!visible||cancelled){respond(message,{returnValue:false});return;}
      var target = JSON.stringify({ id: 'com.jakubjirak.player', params: { target: 'http://127.0.0.1:' + PORT + '/' + id + '/index.html' } });
      broker(service, '/usr/bin/luna-send -w 3000 -n 1 luna://com.webos.applicationManager/launch ' + quote(target), function (stdout) {
        var ok = false; try { ok = JSON.parse(stdout).returnValue === true; } catch (e) { /* Refused. */ }
        respond(message,{ returnValue: ok });
      });
      });
    } catch (e) { respond(message,{ returnValue: false }); }
  });
  service.register('browserCancel',function(message){
    var p=message.payload||{},id=p.id;if(!validId(id)){respond(message,{returnValue:false});return;}
    function cancel(){try{var config=read(id);config.cancelled=true;write(file(id),config);}catch(e){}cancelServer(id,function(){respond(message,{returnValue:true});});}
    if(p.unlessBrowser===true){
      var attempts=0;
      var check=function(){foregroundId(service,function(current){
        if(current==='com.jakubjirak.player')respond(message,{returnValue:true});
        // SAM can briefly expose Live TV while the cold native CBE window is
        // being created. That is still our handoff, not a user cancellation.
        // A real Home/other-app foreground cancels immediately as before.
        else if((current==='com.jakubjirak'||current==='com.webos.app.livetv'||current===null)&&attempts++<24)setTimeout(check,250);
        else cancel();
      });};
      // Native visibility changes before applicationManager publishes the new
      // browser foreground. Do not cancel our own handoff in that interval.
      setTimeout(check,250);
    }else cancel();
  });
  service.register('browserResult', function (message) {
    var id = message.payload && message.payload.id;
    try {
      if (!validId(id)) throw Error('id');
      var config = read(id), result;
      try { result = read(id, '.result.json'); } catch (e) { result = { done: false }; }
      respond(message,{ returnValue: true, baseline: config.preferences, initial: config.initial, result: result });
    } catch (e) { respond(message,{ returnValue: false }); }
  });
}
module.exports = { register: register, preferences: preferences, keys: KEYS, write: write, prune: prune };
