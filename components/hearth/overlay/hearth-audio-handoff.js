/* Bounded LiveTV cleanup on actual Hearth lifecycle events; never changes volume. */
(function (root, doc) {
  'use strict';
  var timer = null;
  var bridges = [];
  function request() {
    timer = null;
    if (doc.hidden || typeof root.PalmServiceBridge !== 'function') return;
    var bridge = new root.PalmServiceBridge();
    bridges.push(bridge);
    var timeout;
    function done() {
      root.clearTimeout(timeout);
      var i = bridges.indexOf(bridge);
      if (i >= 0) bridges.splice(i, 1);
      try { if (bridge.cancel) bridge.cancel(); } catch (ignore) {}
    }
    timeout = root.setTimeout(done, 8000);
    bridge.onservicecallback = done;
    // Return immediately; root worker coalesces duplicate events and rechecks
    // the real foreground before every targeted close. It exits within 80 s.
    var command = 'LD_PRELOAD="" nohup /usr/bin/node /var/lib/webosbrew/hearth-boot-audio/foreground-window.js --foreground >/tmp/hearth-foreground-audio.log 2>&1 </dev/null &';
    try { bridge.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({command: command})); }
    catch (error) { done(); }
  }
  function schedule() {
    if (timer !== null) root.clearTimeout(timer);
    timer = null;
    if (!doc.hidden) timer = root.setTimeout(request, 1000);
  }
  doc.addEventListener('visibilitychange', schedule);
  doc.addEventListener('webOSRelaunch', schedule);
  root.addEventListener('focus', schedule);
  root.addEventListener('load', schedule);
  schedule();
}(window, document));
