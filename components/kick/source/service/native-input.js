'use strict';
// Private, per-player keyboard relay. The native hook never touches inputd.
var fs = require('fs'), net = require('net'), cp = require('child_process'), constants = require('constants');
var APP = '/media/developer/apps/usr/palm/applications/com.jakubjirak.player';
var JAIL = '/var/palm/jail/com.jakubjirak.player';
var keymap = {1:27,28:13,96:13,103:38,105:37,106:39,108:40,158:461,412:461,358:457,119:19,164:179,168:412,207:415,208:417};
function monotonic() { var t = process.hrtime(); return (t[0] * 1000 + Math.floor(t[1] / 1000000)) >>> 0; }
function create(id, disconnected, ready) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw Error('Invalid player session');
  var nativeUid = fs.statSync(JAIL).uid, tmp = JAIL + '/tmp', info = fs.lstatSync(tmp);
  if (!info.isDirectory() || info.uid !== 0 || !(info.mode & 512)) throw Error('Unsafe player temporary directory');
  var directory = tmp + '/kick-control-' + id;
  fs.mkdirSync(directory, 448);
  var directoryFd = fs.openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  var anchor = '/proc/self/fd/' + directoryFd, leasePath = anchor + '/lease', socketPath = anchor + '/socket';
  // Root retains the only writable FD. Native UID must not own/chmod this file.
  var leaseFd = fs.openSync(leasePath, 'wx', 292), lease = new Buffer(8);
  lease.fill(0); lease.write('KICK', 0, 'ascii'); fs.writeSync(leaseFd, lease, 0, 8, 0);
  var peer = null, nativePid = 0, clients = [], pending = null, queue = [], sequence = 0, lastPoll = 0, closed = false;
  function finishPoll() {
    if (!pending) return;
    var p = pending; pending = null; clearTimeout(p.timer);
    var keys = queue; queue = []; p.respond({ keys: keys });
  }
  var server = net.createServer(function (client) {
    if (closed || clients.length >= 4) { client.destroy(); return; }
    clients.push(client); client.pause();
    client.on('error', function () { client.destroy(); });
    client.on('close', function () {
      clients = clients.filter(function (other) { return other !== client; });
      if (peer && peer.socket === client) { peer = null; if (!closed) disconnected(); }
    });
    // SO_PEERCRED comes from the kernel, not the public nonce or sender's PID.
    var source = "import socket,struct,json; s=socket.fromfd(3,socket.AF_UNIX,socket.SOCK_STREAM); p,u,g=struct.unpack('3i',s.getsockopt(socket.SOL_SOCKET,17,12)); print(json.dumps({'pid':p,'uid':u,'gid':g}))";
    var child = cp.spawn('/usr/bin/python', ['-c', source], { stdio: ['ignore', 'pipe', 'ignore', client._handle.fd] });
    var output = '', timer = setTimeout(function () { child.kill(); client.destroy(); }, 1500);
    child.stdout.on('data', function (bytes) { output += bytes; if (output.length > 512) { child.kill(); client.destroy(); } });
    child.on('error', function () { clearTimeout(timer); client.destroy(); });
    child.on('close', function (code) {
      clearTimeout(timer);
      var credentials;
      try { credentials = JSON.parse(output); if (code !== 0 || credentials.uid !== nativeUid) throw Error('UID'); }
      catch (error) { client.destroy(); return; }
      var buffer = '';
      client.on('data', function (bytes) {
        buffer += bytes.toString('ascii');
        if (buffer.length > 4096) { client.destroy(); return; }
        var index, match;
        while ((index = buffer.indexOf('\n')) >= 0) {
          var line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (line.length > 64) { client.destroy(); return; }
          if ((match = /^H([a-f0-9]{32}):([0-9]{1,7})$/.exec(line)) && match[1] === id) {
            try {
              var pid = Number(match[2]);
              if (pid !== credentials.pid || peer) throw Error('Peer');
              var actual = fs.statSync('/proc/' + pid + '/exe'), expected = fs.statSync(APP + '/chrome');
              var cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
              if (actual.ino !== expected.ino || actual.dev !== expected.dev ||
                  cmd.indexOf('http://127.0.0.1:18427/' + id + '/index.html') < 0) throw Error('Identity');
              peer = { socket: client, pid: pid }; nativePid = pid;
            } catch (error) { client.destroy(); return; }
            continue;
          }
          if (!peer || peer.socket !== client) continue;
          if ((match = /^K([a-f0-9]{32}):([0-9]{1,4})$/.exec(line)) && match[1] === id && keymap[match[2]]) {
            if (queue.length >= 16) queue.shift();
            queue.push({ seq: ++sequence, key: keymap[match[2]] }); finishPoll();
          }
        }
      });
      client.resume();
    });
  });
  var heartbeat = setInterval(function () {
    var stamp = peer && !closed && ((monotonic() - lastPoll) >>> 0) <= 1200 ? monotonic() : 0;
    lease.writeUInt32LE(stamp, 4); if (!closed) fs.writeSync(leaseFd, lease, 4, 4, 4);
  }, 250);
  server.on('error', function (error) { close(); ready(error); });
  server.listen(socketPath, function () {
    // Ownership is set before the Native UID can traverse the directory.
    fs.chmodSync(socketPath, 384); fs.chownSync(socketPath, nativeUid, 5000); fs.fchmodSync(directoryFd, 457);
    ready(null);
  });
  function close() {
    if (closed) return; closed = true; clearInterval(heartbeat);
    lease.writeUInt32LE(0, 4); fs.writeSync(leaseFd, lease, 4, 4, 4); finishPoll();
    clients.forEach(function (client) { client.destroy(); }); server.close();
    try { fs.unlinkSync(socketPath); } catch (error) {}
    try { fs.unlinkSync(leasePath); } catch (error) {}
    fs.closeSync(leaseFd); fs.closeSync(directoryFd);
    try { fs.rmdirSync(directory); } catch (error) {}
  }
  return {
    uid: nativeUid,
    poll: function (res, respond) {
      lastPoll = monotonic(); if (pending) finishPoll();
      var current = { res: res, respond: respond, timer: setTimeout(finishPoll, 450) }; pending = current;
      res.on('close', function () { if (pending === current) { clearTimeout(current.timer); pending = null; } });
      if (queue.length) finishPoll();
    },
    close: close,
    terminate: function () {
      if (!nativePid) return;
      try {
        var actual = fs.statSync('/proc/' + nativePid + '/exe'), expected = fs.statSync(APP + '/chrome');
        var cmd = fs.readFileSync('/proc/' + nativePid + '/cmdline', 'utf8');
        var status = fs.readFileSync('/proc/' + nativePid + '/status', 'utf8').match(/^Uid:\s+(\d+)/m);
        if (actual.ino === expected.ino && actual.dev === expected.dev && status && Number(status[1]) === nativeUid &&
            cmd.indexOf('http://127.0.0.1:18427/' + id + '/index.html') >= 0) process.kill(nativePid, 'SIGTERM');
      } catch (error) { /* The exact session has already ended. */ }
    }
  };
}
// A loopback URL nonce is visible in /proc/<pid>/cmdline. Authenticate its HTTP
// clients by the kernel's reverse TCP tuple UID, not only that nonce.
function clientUid(socket, serverPort) {
  if (socket.kickUid !== undefined) return socket.kickUid;
  var port = Number(socket.remotePort).toString(16).toUpperCase(); while (port.length < 4) port = '0' + port;
  var target = Number(serverPort).toString(16).toUpperCase(); while (target.length < 4) target = '0' + target;
  var lines = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n');
  for (var i = 1; i < lines.length; i++) {
    var fields = lines[i].trim().split(/\s+/);
    if (fields[1] === '0100007F:' + port && fields[2] === '0100007F:' + target && fields[3] === '01') {
      socket.kickUid = Number(fields[7]); return socket.kickUid;
    }
  }
  return -1;
}
function prepare(done) {
  cp.execFile('/usr/bin/python', [require('path').join(__dirname, 'native-prepare.py')], { timeout: 6500, maxBuffer: 16384 }, done);
}
module.exports = { create: create, clientUid: clientUid, prepare: prepare };
