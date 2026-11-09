/* ES5 integration: production service + real HTTP sockets, with only TLS/Luna replaced. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var net = require('net');
var vm = require('vm');
var handlers = {}, agent, sockets = [], connections = 0;
var playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720.m3u8\n';
var server = http.createServer(function (req, res) { res.end(playlist); });
server.keepAliveTimeout = 0;
server.on('connection', function (socket) { connections++; sockets.push(socket); });
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function inventory() {
  var free = 0, active = 0;
  Object.keys(agent.freeSockets).forEach(function (key) {
    agent.freeSockets[key].forEach(function (socket) { if (!socket.destroyed) free++; });
  });
  Object.keys(agent.sockets).forEach(function (key) {
    agent.sockets[key].forEach(function (socket) { if (!socket.destroyed) active++; });
  });
  return { free: free, active: active };
}
function invoke(host) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Service reply timed out')); }, 15000);
    handlers.prepare({ payload: { url: 'https://' + host + '/master.m3u8' }, respond: function (data) {
      clearTimeout(timer);
      try { assert.strictEqual(data.returnValue, true); assert.strictEqual(data.best.height, 720); resolve(); }
      catch (error) { reject(error); }
    } });
  }).then(tick);
}
function cleanup() {
  if (agent) agent.destroy();
  sockets.forEach(function (socket) { socket.destroy(); });
  server.close();
}
server.listen(0, '127.0.0.1', function () {
  function Agent(options) {
    agent = new http.Agent(options);
    // Preserve logical per-origin pool keys, but connect every socket to loopback.
    agent.createConnection = function () { return net.connect(server.address().port, '127.0.0.1'); };
    return agent;
  }
  function Service() { this.register = function (name, handler) { handlers[name] = handler; }; }
  var context = vm.createContext({ Promise: Promise, Buffer: Buffer, setTimeout: setTimeout, clearTimeout: clearTimeout,
    require: function (name) {
      if (name === 'https') return { Agent: Agent, get: function (options, callback) {
        var local = {};
        Object.keys(options).forEach(function (key) { local[key] = options[key]; });
        local.port = server.address().port;
        return http.get(local, callback);
      } };
      if (name === 'zlib') return require('zlib');
      if (name === 'webos-service') return Service;
      if(name==='./discovery')return require('./service/discovery');if(name==='./browser-session')return require('./service/browser-session');throw new Error('Unexpected dependency: ' + name);
    } });
  vm.runInContext(fs.readFileSync('service/index.js', 'utf8'), context);
  var work = Promise.resolve();
  for (var i = 0; i < 25; i++) (function (index) {
    work = work.then(function () { return invoke('host' + index + '.playback.live-video.net'); });
  }(i));
  work.then(function () {
    var result = inventory();
    assert.ok(result.free <= 2, 'Idle sockets across all origins must stay bounded; retained ' + result.free);
    assert.strictEqual(result.active, 0, 'Completed requests release active sockets');
    var before = connections;
    // Repeated fixed-origin requests still reuse the retained connection.
    return invoke('stream.kick.com').then(function () { return invoke('stream.kick.com'); }).then(function () {
      assert.strictEqual(connections - before, 1, 'Keep-alive reuse survives the global idle limit');
      return invoke('stream.kick.com');
    }).then(function () {
      assert.strictEqual(connections - before, 1);
      console.log('Service resources: passed on ' + process.version + ' (25 origins, ' + inventory().free + ' idle sockets, same-origin reuse).');
    });
  }).then(cleanup, function (error) { cleanup(); console.error(error.stack); process.exitCode = 1; });
});
