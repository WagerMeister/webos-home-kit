'use strict';
// One loopback-only, per-replay process. No external server or root boot hook.
var fs = require('fs'), http = require('http'), path = require('path'), cp = require('child_process'), EventEmitter = require('events').EventEmitter;
var sessions = require('./browser-session');
var nativeInput = require('./native-input'), input = null;
function mono() { var t = process.hrtime(); return t[0] * 1000 + Math.floor(t[1] / 1000000); }
var configPath = process.argv[2], constants = require('constants');
if (!configPath || !/^[a-f0-9]{32}\.json$/.test(path.basename(configPath))) process.exit(1);
// Pin the user-writable directory: never follow a replaced directory or config
// symlink while reading/writing as root. Writes use exclusive random temp FDs.
var directoryFd = fs.openSync(path.dirname(configPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
var directoryOwner = fs.fstatSync(directoryFd);
configPath = '/proc/self/fd/' + directoryFd + '/' + path.basename(configPath);
var configFd = fs.openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
var owner = fs.fstatSync(configFd);
if (!owner.isFile() || owner.size > 180000 || owner.uid !== directoryOwner.uid || owner.gid !== directoryOwner.gid) process.exit(1);
var configBytes = new Buffer(owner.size), offset = 0, count;
while (offset < owner.size) { count = fs.readSync(configFd, configBytes, offset, owner.size - offset, null); if (!count) throw Error('Truncated session'); offset += count; }
fs.closeSync(configFd);
var config = JSON.parse(configBytes.toString('utf8')); 
if (!/^[a-f0-9]{32}$/.test(config.id) || config.port !== 18427 || !sessions.preferences(config.preferences)) process.exit(1);
var prefix = '/' + config.id + '/', handlers = {}, closing = false, lastSeen = mono(), started = mono(), hiddenTimer;
var result = { done: false, preferences: config.preferences, position: config.initial.position, duration: 0, rate: config.initial.rate };
var app = path.resolve(__dirname, '../../applications/com.jakubjirak');
var allowed = ['channel', 'replay', 'prepare', 'statuses', 'directory', 'liveFavorites', 'updates'];
global.KICK_BROWSER_CONTEXT = { Service: function () { this.register = function (name, handler) { if (allowed.indexOf(name) >= 0) handlers[name] = handler; }; } };
require('./index');
function reply(res, status, body, type) {
  if (res.finished || res.destroyed) return;
  try {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }catch(e){/* Client disconnected. */}
}
function persist() { sessions.write(configPath.replace(/\.json$/, '.result.json'), result, owner); }
function stop(reason) {
  if (closing) return;
  closing = true; result.done = true; result.reason = reason; try { persist(); } catch (e) { /* Last saved progress remains. */ }
  if (input) input.close();
  function ended() {
    if (input) input.terminate(); server.close();
    // Only Kick's duplicate, identical Developer Mode mounts are collapsed.
    // Failure never blocks playback teardown or changes other jails.
    cp.execFile('/usr/bin/python', [path.join(__dirname, 'native-mount-cleanup.py')], { timeout: 3000, maxBuffer: 16384 }, function () {});
  }
  if (reason === 'back') cp.execFile('/usr/bin/luna-send', ['-w', '2500', '-n', '1', 'luna://com.webos.applicationManager/launch', '{"id":"com.jakubjirak"}'],
    { timeout: 3500, maxBuffer: 16384 }, ended);
  else ended();
  setTimeout(function () { process.exit(0); }, 7000);
}
var server = http.createServer(function (req, res) {
  if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== '127.0.0.1:' + config.port || req.url.indexOf(prefix) !== 0) return reply(res, 404, {});
  var route = req.url.slice(prefix.length);
  var uid;
  try { uid = nativeInput.clientUid(req.socket, config.port); } catch (e) { uid = -1; }
  if (uid !== 0 && (!input || uid !== input.uid) && !(uid === owner.uid && /^(ready|cancel)$/.test(route))) return reply(res, 403, {});
  if (closing) return reply(res, 410, {});
  lastSeen = mono();
  if (req.method === 'GET' && route === 'ready') return reply(res, 200, {});
  if (req.method === 'GET' && route === 'session') {
    clearTimeout(hiddenTimer); result.done = false;
    return reply(res, 200, { initial: { channel: config.initial.channel, video: config.initial.video,
      position: result.position, rate: result.rate }, preferences: result.preferences });
  }
  if (req.method === 'GET' && /^(?:index\.html|runtime\.js|i18n\.js|app\.js|player\.js|browse\.js|style\.css|vendor\/hls\.light\.min\.js|fonts\/[A-Za-z0-9._-]+)$/.test(route)) {
    var type = /\.js$/.test(route) ? 'application/javascript' : /\.css$/.test(route) ? 'text/css' : /\.woff2$/.test(route) ? 'font/woff2' : 'text/html; charset=utf-8';
    return fs.readFile(path.join(app, route), function (error, data) { if (error) reply(res, 404, {}); else reply(res, 200, data, type); });
  }
  if (req.method !== 'POST' || req.headers['x-kick-session'] !== config.id || String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return reply(res, 403, {});
  var chunks = [], bytes = 0;
  req.on('data', function (chunk) { bytes += chunk.length; if (bytes > 170000) req.destroy(); else chunks.push(chunk); });
  req.on('end', function () {
    var body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reply(res, 400, {}); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(res, 400, {});
    if (route === 'keys') {
      if (uid !== 0 && uid !== input.uid || body.fullscreen !== true) return reply(res, 403, {});
      input.poll(res, function (data) { reply(res, 200, data); }); return;
    }
    if (route === 'cancel') { reply(res, 200, {}); stop('hidden'); return; }
    if (route === 'sync') {
      var prefs = sessions.preferences(body.preferences);
      if (!prefs || typeof body.position !== 'number' || !isFinite(body.position) || body.position < 0 || body.position > 2592000 ||
          typeof body.duration !== 'number' || !isFinite(body.duration) || body.duration < 0 || body.duration > 2592000 ||
          [1, 1.25, 1.5, 1.75, 2].indexOf(body.rate) < 0 || ['progress', 'back', 'hidden'].indexOf(body.reason) < 0) return reply(res, 400, {});
      result.preferences = prefs; result.position = body.position; result.duration = body.duration; result.rate = body.rate;
      if(body.diagnostics&&typeof body.diagnostics==='object'){var d=body.diagnostics;result.diagnostics={key:typeof d.key==='number'?d.key:0,focus:String(d.focus||'').slice(0,64),hidden:d.hidden===true,paused:d.paused===true,ready:typeof d.ready==='number'?d.ready:0,error:String(d.error||'').slice(0,200),status:String(d.status||'').slice(0,240),at:typeof d.at==='number'&&isFinite(d.at)?d.at:0,time:typeof d.time==='number'&&isFinite(d.time)?d.time:0,rate:typeof d.rate==='number'&&isFinite(d.rate)?d.rate:0,width:typeof d.width==='number'?d.width:0,height:typeof d.height==='number'?d.height:0,fullscreen:d.fullscreen===true};}
      result.done = body.reason !== 'progress'; result.reason = body.reason;
      try { persist(); } catch (e) { return reply(res, 500, { returnValue: false }); }
      reply(res, 200, { returnValue: true });
      if (body.reason === 'back') stop('back');
      // A reload also hides the old document. Allow the replacement document
      // to resume the latest state; a genuinely hidden player exits promptly.
      if (body.reason === 'hidden') { clearTimeout(hiddenTimer); hiddenTimer = setTimeout(function () { stop('hidden'); }, 500); }
      return;
    }
    if (route.indexOf('api/') === 0 && allowed.indexOf(route.slice(4)) >= 0 && handlers[route.slice(4)]) {
      var message = new EventEmitter(); message.payload = body;
      message.respond = function (data) { reply(res, 200, data); };
      res.on('close', function () { if (!res.finished) message.emit('cancel'); });
      try { handlers[route.slice(4)](message); } catch (e) { reply(res, 500, { returnValue: false }); }
      return;
    }
    reply(res, 404, {});
  });
});
server.maxConnections = 12;
server.setTimeout(45000);
server.on('error', function () { process.exit(1); });
nativeInput.prepare(function (error) {
  if (error) { process.stderr.write(String(error) + '\n'); process.exit(1); return; }
  try {
    input = nativeInput.create(config.id, function () { stop('hidden'); }, function (error) {
      if (error) { process.stderr.write(String(error) + '\n'); process.exit(1); return; }
      server.listen(config.port, '127.0.0.1', function () { sessions.write(path.join(path.dirname(configPath), 'active.json'), { id: config.id }, owner); });
    });
  } catch (error) { process.stderr.write(String(error) + '\n'); process.exit(1); }
});
setInterval(function () { if (mono() - lastSeen > 60000 || mono() - started > 43200000) stop('hidden'); }, 10000);
