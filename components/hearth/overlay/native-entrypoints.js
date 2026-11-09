/* Open the same Quick Settings panel as the remote's gear/MENU key.
 * Does not change defaultApps, volume, boot targets or network settings. */
(function (root) {
  'use strict';
  var COMMAND = '/usr/bin/luna-send -w 3000 -n 1 luna://com.webos.service.networkinput/sendSpecialKey \'{"key":"MENU"}\'';
  function openSettings() {
    return new Promise(function (resolve, reject) {
      if (!root.PalmServiceBridge) { reject(new Error('TV service unavailable')); return; }
      var bridge = new root.PalmServiceBridge(), finished = false;
      function finish(error) {
        if (finished) return;
        finished = true;
        root.clearTimeout(timer);
        try { bridge.cancel(); } catch (ignore) {}
        if (error) reject(error); else resolve();
      }
      var timer = root.setTimeout(function () { finish(new Error('Quick Settings timed out')); }, 6000);
      bridge.onservicecallback = function (message) {
        try {
          var result = JSON.parse(message);
          if (result.returnValue !== true || typeof result.stdoutString !== 'string') throw new Error('Quick Settings request failed');
          var nativeResult = JSON.parse(result.stdoutString);
          if (!nativeResult || nativeResult.returnValue !== true) throw new Error('Quick Settings refused');
          finish();
        } catch (error) { finish(error); }
      };
      try { bridge.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({command: COMMAND})); }
      catch (error) { finish(error); }
    });
  }
  root.__hearthSystem = {openSettings: openSettings};
}(typeof window !== 'undefined' ? window : this));
