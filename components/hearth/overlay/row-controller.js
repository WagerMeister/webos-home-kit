/* Native LG app ordering, read-only. Small metadata cache, visible-only refresh. */
(function (root, doc) {
  'use strict';
  var model = root.__hearthRowModel, KEY = 'hearth-semantic-row-state-v1';
  var state = null, fresh = false, listeners = [], appListeners = [];
  var timer = null, request = null, serial = 0, lastAttempt = 0;
  var COMMAND = '/usr/bin/luna-send -w 3000 -n 1 luna://com.webos.applicationManager/listLaunchPoints \'{}\'';
  try { var saved = JSON.parse(root.localStorage.getItem(KEY) || 'null'); if (model.valid(saved)) state = saved; } catch (ignore) {}
  function subscribe(list, callback) {
    list.push(callback);
    return function () { var at = list.indexOf(callback); if (at !== -1) list.splice(at,1); };
  }
  function emit(list) { list.slice().forEach(function (callback) { callback(); }); }
  function ids(snapshot) { return snapshot ? snapshot.order.slice().sort().join('|') : ''; }
  function schedule(delay) {
    root.clearTimeout(timer); timer = null;
    if (!doc.hidden) timer = root.setTimeout(refresh, delay);
  }
  function refresh() {
    timer = null;
    if (doc.hidden || request) return;
    if (!root.PalmServiceBridge) { schedule(30000); return; }
    // Coalesce relaunch/visibility/poll signals without suppressing a pending refresh.
    if (Date.now() - lastAttempt < 1200) { schedule(1200); return; }
    lastAttempt = Date.now();
    var bridge = new root.PalmServiceBridge(), generation = ++serial, done = false;
    function finish(error, next) {
      if (done) return;
      done = true; root.clearTimeout(deadline);
      try { bridge.cancel(); } catch (ignore) {}
      if (generation !== serial) return;
      request = null;
      if (!error) {
        var appsChanged = ids(state) !== ids(next);
        var changed = !fresh || JSON.stringify(state) !== JSON.stringify(next);
        state = next; fresh = true;
        if (changed) { try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (ignore) {} }
        if (!doc.hidden) { if (changed) emit(listeners); if (appsChanged) emit(appListeners); }
      } else if (!doc.hidden && fresh) {
        // A previously successful snapshot is no longer authoritative on error:
        // retain its ordering but never hide a newly installed app using it.
        fresh = false; emit(listeners);
      }
      schedule(30000);
    }
    var deadline = root.setTimeout(function () { finish(new Error('Native app list timed out')); }, 6000);
    request = {cancel:function () { finish(new Error('Hidden')); }};
    bridge.onservicecallback = function (message) {
      try {
        var reply = JSON.parse(message);
        if (reply.returnValue !== true || typeof reply.stdoutString !== 'string') throw new Error('Native app list failed');
        finish(null,model.parse(JSON.parse(reply.stdoutString)));
      } catch (error) { finish(error); }
    };
    try { bridge.call('luna://org.webosbrew.hbchannel.service/exec',JSON.stringify({command:COMMAND})); }
    catch (error) { finish(error); }
  }
  root.__hearthRows = {
    arrange:function (items,rows) { return model.arrange(items,rows,state,fresh); },
    subscribe:function (callback) { return subscribe(listeners,callback); },
    subscribeApps:function (callback) { return subscribe(appListeners,callback); },
    canReorder:function (key) { return !model.system(key,state); },
    menuItems:function (items) { return items.filter(function (item) { return item.key !== 'favourite'; }).map(function (item) {
      if (item.key !== 'reorder') return item;
      return {key:item.key,label:'Порядок в LG Home',detail:'Изменения LG Home подтягиваются сюда',run:item.run};
    }); },
    status:function () { return {fresh:fresh,state:state,requestActive:!!request}; }
  };
  doc.addEventListener('visibilitychange',function () {
    if (doc.hidden) { root.clearTimeout(timer); timer = null; if (request) request.cancel(); }
    else { emit(listeners); schedule(300); }
  });
  doc.addEventListener('webOSRelaunch',function () { schedule(300); });
  schedule(4500);
}(window,document));
