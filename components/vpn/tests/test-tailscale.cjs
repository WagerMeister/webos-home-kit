'use strict';
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const definition = require('../root/providers/tailscale');
const example = require('../config.example.json');

function running(extra = {}) {
  return {BackendState: 'Running', Self: {Online: true},
    Peer: {x: {ExitNode: true, Online: true, TailscaleIPs: ['100.64.0.10'],
      RxBytes: 100, LastHandshake: '2024-01-01T00:00:00Z'}}, ...extra};
}
function fixture(snapshot = running(), enabled = true, holdRestore = false) {
  let raw = snapshot, time = 1700000000000, compatibility = false, probe = null, closed = false, restore = null;
  const commands = [], pending = [], failures = [], intervals = [], killed = [];
  function Clock() { return new Date(time); }
  Clock.now = () => time;
  const io = {
    readFileSync(name) { if (name.endsWith('/tailscaled.pid')) return '42'; throw Error('missing'); },
    existsSync(name) { return name.endsWith('/routing-compat.json') && compatibility; },
    statSync() { throw Error('missing'); }
  };
  const cp = {
    spawn() { throw Error('Existing daemon must be reused'); },
    execFile(file, args, options, done) {
      const child = {kill() { child.killed = true; }};
      commands.push({file, args, child});
      if (file === '/usr/bin/python') {
        if (args[1] === 'restore' && holdRestore) restore = done;
        else { compatibility = args[1] === 'enable'; done(null, 'OK'); }
      }
      else if (file === '/sbin/ip') done(null, '1.1.1.1 dev tailscale0');
      else if (file === '/usr/bin/curl') probe = done;
      else pending.push(done);
      return child;
    }
  };
  const http = {request(options, respond) {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.abort = () => {};
    req.end = () => {
      const res = new EventEmitter(); res.statusCode = 200;
      respond(res); res.emit('data', Buffer.from(JSON.stringify(raw))); res.emit('end');
    };
    return req;
  }};
  const engine = definition.create({root: '/private/test-connection',
    settings: example.providerConfig || example, enabled, ownProcess: () => true,
    onFailure: code => failures.push(code), log() {},
    dependencies: {fs: io, cp, http, Date: Clock, process: {pid: 123, env: {}, kill(pid) { killed.push(pid); }},
      timers: {setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() { closed = true; }}}});
  engine.start();
  return {engine, commands, pending, failures, killed,
    probe(code = '204') { assert(probe); const fn = probe; probe = null; fn(null, code); },
    takeProbe() { const fn = probe; probe = null; return fn; },
    restore(error = null) { assert(restore); const fn = restore; restore = null; if (!error) compatibility = false; fn(error, ''); },
    tick(value = raw, elapsed = 0) { raw = value; time += elapsed; intervals[0](); },
    ack(value = raw) { raw = value; const fn = pending.shift(); assert(fn); fn(null, ''); },
    compatibility() { return compatibility; }, closed() { return closed; }};
}

const good = fixture();
assert.equal(good.engine.status(false).connected, false);
good.probe();
assert.equal(good.engine.status(false).connected, true);
assert.equal(good.engine.status(false).state, 'on');
assert(good.compatibility());
const late = fixture();
const lateProbe = late.takeProbe();
late.engine.request('off'); lateProbe(null, '204');
assert.equal(late.engine.status(false).connected, false, 'Late probe cannot undo off');
late.ack({BackendState: 'Stopped', Peer: {}});
assert.equal(late.engine.status(false).state, 'off');
assert.equal(late.engine.status(false).quiescent, true);
assert(!late.compatibility(), 'Off restores reverse-path filtering');
late.engine.close();
assert.deepEqual(late.killed, [42], 'Off plus controller shutdown releases the verified old daemon');

for (const snapshot of [running({Self: {Online: false}}), running({Peer: {}}),
  running({Peer: {x: {ExitNode: true, Online: true, TailscaleIPs: ['100.64.0.10'], RxBytes: 0,
    LastHandshake: '0001-01-01T00:00:00Z'}}})]) {
  const f = fixture(snapshot);
  assert.equal(f.engine.status(false).connected, false, 'No readiness without self/exit traffic/handshake');
  f.engine.close();
}
const failed = fixture();
failed.probe('503');
failed.tick(running(), 46001);
assert.deepEqual(failed.failures, ['connection_failed_restored']);
assert(failed.commands.some(c => c.args.includes('down')));
failed.ack({BackendState: 'Stopped', Peer: {}});
assert.equal(failed.engine.status(false).state, 'failed');
assert.equal(failed.engine.status(false).quiescent, true);
const delayed = fixture(running(), true, true);
delayed.probe('503'); delayed.tick(running(), 46001);
delayed.ack({BackendState: 'Stopped', Peer: {}});
assert.equal(delayed.engine.status(false).state, 'disconnecting', 'Cannot claim restored while cleanup is pending');
assert.equal(delayed.engine.status(false).quiescent, false);
delayed.restore(Error('write failed'));
assert.equal(delayed.engine.status(false).state, 'disconnecting', 'Failed cleanup must not claim restored');
assert.equal(delayed.engine.status(false).quiescent, false);
delayed.tick({BackendState: 'Stopped', Peer: {}});
delayed.restore();
assert.equal(delayed.engine.status(false).state, 'failed');
assert.equal(delayed.engine.status(false).quiescent, true);

const login = fixture({BackendState: 'NeedsLogin', Peer: {}, AuthURL: 'https://login.tailscale.com/a/TESTONLY'}, true);
assert.equal(login.engine.status(false).authURL, undefined);
assert.equal(login.engine.status(true).authURL, 'https://login.tailscale.com/a/TESTONLY');
const before = login.commands.length;
login.engine.request('login');
assert.equal(login.commands.length, before, 'Reading prepared login must not invalidate its QR URL');
login.engine.request('on');
const up = login.commands.find(c => c.file.endsWith('/tailscale'));
assert(up.args.includes('--accept-dns=false') && up.args.includes('--accept-routes=false'));
assert(up.args.includes('--shields-up=true') && up.args.includes('--netfilter-mode=off'));
assert(!definition.validateAuthURL('https://evil.example/a/TESTONLY'));
assert(!definition.validateAuthURL('https://login.tailscale.com.evil.example/a/TESTONLY'));
good.engine.close();
assert(good.closed(), 'Controller restart must release polling resources');
assert.deepEqual(good.killed, [], 'Controller restart must preserve an established connection');
console.log('PASS: Tailscale readiness, stale probe rejection, fail-open, route restoration, preserved login URL and safe client flags');
