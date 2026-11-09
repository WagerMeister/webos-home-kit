'use strict';

var HEARTH = 'tld.my.customlauncher';
var LIVE_TV = 'com.webos.app.livetv';
var MANAGER = 'luna://com.webos.applicationManager/';

// One bounded boot cleanup, never a foreground watcher and never a global mute.
function cleanup(call, later, finish) {
  function foreground(next) {
    call(MANAGER + 'getForegroundAppInfo', {}, function (error, result) {
      if (error || !result || result.returnValue !== true) return finish('foreground_unverified');
      if (result.appId !== HEARTH) return finish('skipped_other_foreground', {appId: result.appId});
      next();
    });
  }
  foreground(function () {
    call(MANAGER + 'running', {}, function (error, result) {
      if (error || !result || result.returnValue !== true || !Array.isArray(result.running)) return finish('running_unverified');
      var exists = result.running.some(function (app) { return app.id === LIVE_TV; });
      if (!exists) return finish('no_background_tv');
      // Recheck immediately before the only mutating call.
      foreground(function () {
        call(MANAGER + 'closeByAppId', {id: LIVE_TV}, function (error, result) {
          if (error || !result || result.returnValue !== true) return finish('tv_close_refused');
          function verify(remaining) {
            call(MANAGER + 'running', {}, function (error, result) {
              if (error || !result || result.returnValue !== true || !Array.isArray(result.running)) return finish('close_outcome_unverified');
              if (!result.running.some(function (app) { return app.id === LIVE_TV; })) return finish('background_tv_closed');
              if (!remaining) return finish('tv_still_running');
              later(function () { verify(remaining - 1); }, 500);
            });
          }
          later(function () { verify(6); }, 500);
        });
      });
    });
  });
}

module.exports.cleanup = cleanup;

function main() {
  var fs = require('fs');
  var cp = require('child_process');
  var path = '/tmp/hearth-boot-audio';
  var lock;
  try { lock = fs.openSync(path + '.lock', 'wx', 384); }
  catch (error) { process.exit(0); }
  fs.closeSync(lock);
  var ended = false;
  var deadline = Date.now() + 55000;
  function finish(status, detail) {
    if (ended) return;
    ended = true;
    var result = {at: new Date().toISOString(), status: status, detail: detail || null};
    fs.writeFileSync(path + '.result.json', JSON.stringify(result) + '\n', {mode: 384});
    console.log(JSON.stringify(result));
  }
  function call(uri, payload, callback) {
    cp.execFile('/usr/bin/luna-send', ['-w', '3000', '-n', '1', uri, JSON.stringify(payload)],
      {timeout: 4000, maxBuffer: 131072}, function (error, stdout) {
        if (error) return callback(error);
        var parsed;
        try { parsed = JSON.parse(String(stdout)); }
        catch (parseError) { return callback(parseError); }
        callback(null, parsed);
      });
  }
  function waitForHearth(remaining) {
    call(MANAGER + 'getForegroundAppInfo', {}, function (error, result) {
      if (!error && result && result.returnValue === true && result.appId === HEARTH) {
        // Let the initial foreground handoff settle; cleanup rechecks ownership.
        return setTimeout(function () { cleanup(call, setTimeout, finish); }, 1000);
      }
      if (!remaining) return finish('skipped_other_or_unverified_foreground');
      setTimeout(function () { waitForHearth(remaining - 1); }, 1000);
    });
  }
  function ready() {
    if (Date.now() > deadline) return finish('boot_readiness_timeout');
    call('luna://com.webos.bootManager/getBootStatus', {subscribe: false}, function (error, result) {
      if (!error && result && result.returnValue === true && result.signals && result.signals['boot-done'] && result.signals['rest-boot-done']) {
        if (result.firstAppId !== HEARTH || result.firstAppLaunched !== true) return finish('skipped_non_hearth_boot');
        return waitForHearth(5);
      }
      setTimeout(ready, 1000);
    });
  }
  ready();
}

if (require.main === module) main();
