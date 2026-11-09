'use strict';

// Observe only a bounded foreground handoff, including late LiveTV startup.
function observe(clean, later, now, finish, duration) {
  var started = now();
  var checks = 0;
  var closed = 0;
  var events = [];
  function done(status, detail) {
    finish(status, {checks: checks, stopped: closed, events: events, elapsedMs: now() - started, last: detail || null});
  }
  function step() {
    if (now() - started >= duration) return done(closed ? 'boot_tv_stopped' : 'no_background_tv_audio');
    checks += 1;
    clean(function (status, detail) {
      if (status === 'boot_tv_stopped') {
        closed += 1;
        events.push({elapsedMs: now() - started, broadcastId: detail && detail.broadcastId});
      }
      else if (status !== 'no_background_tv_audio') return done(status, detail);
      if (closed >= 3) return done('boot_audio_repeatedly_restarted');
      later(step, Math.min(2000, Math.max(0, duration - (now() - started))));
    });
  }
  step();
}
module.exports.observe = observe;

function boundedCall(call, now, deadline) {
  return function (uri, payload, callback) {
    if (uri === 'luna://com.webos.service.tv.broadcast/stop' && now() >= deadline) {
      return callback(new Error('Foreground cleanup window expired'));
    }
    call(uri, payload, callback);
  };
}
module.exports.boundedCall = boundedCall;

function main() {
  var fs = require('fs');
  var cp = require('child_process');
  var cleanup = require('./boot-pipeline-cleanup.js').cleanup;
  var boot = process.argv.indexOf('--boot') >= 0;
  var locked = process.argv.indexOf('--locked') >= 0;
  var base = '/tmp/hearth-' + (boot ? 'boot' : 'foreground') + '-audio';
  var lockPath = '/tmp/hearth-audio-window.lock';
  var ended = false;
  var start = Date.now();
  var hardTimer = setTimeout(function () { finish('hard_timeout'); }, boot ? 140000 : 80000);
  function finish(status, detail) {
    if (ended) return;
    ended = true;
    clearTimeout(hardTimer);
    var result = {at: new Date().toISOString(), implementation: 'reserved-boot-pipeline-v3', mode: boot ? 'boot' : 'foreground',
      status: status, detail: detail || null, elapsedMs: Date.now() - start};
    fs.writeFileSync(base + '.result.json', JSON.stringify(result) + '\n', {mode: 384});
    if (locked) fs.writeFileSync('/tmp/hearth-audio-window.result.json', JSON.stringify(result) + '\n', {mode: 384});
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  function call(uri, payload, callback) {
    if (ended) return;
    cp.execFile('/usr/bin/luna-send', ['-w', '3000', '-n', '1', uri, JSON.stringify(payload)],
      {timeout: 4000, maxBuffer: 131072}, function (error, stdout) {
        if (ended) return;
        if (error) return callback(error);
        var parsed;
        try { parsed = JSON.parse(String(stdout)); }
        catch (parseError) { return callback(parseError); }
        callback(null, parsed);
      });
  }
  function begin() {
    if (!locked) {
      // Kernel flock owns exclusion and releases it on process death. No PID
      // files, stale-lock unlink, or inherited lock descriptors in luna-send.
      var child = cp.spawn('/usr/bin/flock', ['-n', '-E', '73', '-o', lockPath,
        '/usr/bin/node', __filename, '--locked', boot ? '--boot' : '--foreground'], {stdio: 'inherit'});
      child.on('error', function () { finish('worker_spawn_failed'); });
      if (child.pid) {
        child.unref();
        clearTimeout(hardTimer);
        process.exit(0);
      }
      return;
    }
    var deadline = Date.now() + 60000;
    var safeCall = boundedCall(call, Date.now, deadline);
    observe(function (next) { cleanup(safeCall, setTimeout, next); }, setTimeout, Date.now, finish, 60000);
  }
  function ready() {
    if (Date.now() - start > 55000) return finish('boot_readiness_timeout');
    call('luna://com.webos.bootManager/getBootStatus', {subscribe: false}, function (error, result) {
      if (!error && result && result.returnValue === true && result.signals && result.signals['boot-done'] && result.signals['rest-boot-done']) {
        if (result.firstAppId !== 'tld.my.customlauncher' || result.firstAppLaunched !== true) return finish('skipped_non_hearth_boot');
        return begin();
      }
      setTimeout(ready, 1000);
    });
  }
  if (boot && !locked) ready(); else begin();
}
if (require.main === module) main();
