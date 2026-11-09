/* Semantic rows for this TV. ES5, pure model; no service calls or mutations. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__hearthRowModel = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var ranks = {'com.webos.app.livetv':10, 'com.webos.app.browser':30,
    'com.webos.app.photovideo':31, 'com.webos.app.music':32,
    'lg-home':50, 'com.webos.app.homeconnect':51, 'com.webos.app.discovery':52,
    'org.webosbrew.hbchannel':53, 'system-settings':90, 'settings':91};
  var own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  function fixed(key) {
    return key === 'lg-home' || key === 'system-settings' || key === 'settings' ||
      key === 'com.webos.app.livetv' || /^com\.webos\.app\.(?:hdmi\d+|externalinput\.|smhl)/.test(key);
  }
  function parse(reply) {
    if (!reply || reply.returnValue !== true || !Array.isArray(reply.launchPoints) || !reply.launchPoints.length || reply.launchPoints.length > 1000) throw new Error('Native app list unavailable');
    var order = [], system = [], seen = Object.create(null);
    reply.launchPoints.forEach(function (item) {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(item.id)) throw new Error('Invalid native app id');
      if (own(seen, item.id)) return;
      seen[item.id] = true; order.push(item.id);
      if (item.systemApp === true) system.push(item.id);
    });
    return {version:1, order:order, system:system};
  }
  function valid(state) {
    return !!state && state.version === 1 && Array.isArray(state.order) && state.order.length > 0 && state.order.length <= 1000 &&
      Array.isArray(state.system) && state.order.every(function (id, i) { return typeof id === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(id) && state.order.indexOf(id) === i; }) &&
      state.system.every(function (id) { return state.order.indexOf(id) !== -1; });
  }
  function system(key, state) {
    if (own(ranks,key) || fixed(key)) return true;
    if (state && state.system.indexOf(key) !== -1) return true;
    if (state && state.order.indexOf(key) !== -1) return false;
    return /^(?:com\.webos\.app\.|com\.palm\.app\.)/.test(key);
  }
  function rank(key) {
    if (own(ranks,key)) return ranks[key];
    var hdmi = /^com\.webos\.app\.hdmi(\d+)$/.exec(key);
    if (hdmi) return 10 + Math.min(9, Number(hdmi[1]));
    if (fixed(key)) return 20;
    return 70;
  }
  function arrange(items, rows, state, authoritative) {
    var first = [], second = [], seen = Object.create(null), positions = Object.create(null);
    if (state) state.order.forEach(function (id, index) { positions[id] = index; });
    items.forEach(function (item, index) {
      if (!item || typeof item.key !== 'string' || own(seen,item.key)) return;
      seen[item.key] = true;
      if (authoritative && state && !fixed(item.key) && !own(positions,item.key)) return;
      var entry = {item:item, index:index};
      (system(item.key,state) ? second : first).push(entry);
    });
    first.sort(function (a,b) {
      var pa = own(positions,a.item.key) ? positions[a.item.key] : 100000 + a.index;
      var pb = own(positions,b.item.key) ? positions[b.item.key] : 100000 + b.index;
      return pa - pb || a.index - b.index;
    });
    second.sort(function (a,b) { return rank(a.item.key) - rank(b.item.key) || a.index - b.index; });
    var result = first.concat(second).map(function (entry) { return entry.item; });
    var sizes = rows === 1 ? [result.length] : first.length && second.length ? [first.length, second.length] : [result.length];
    return {items:result, sizes:sizes, userCount:first.length, systemCount:second.length};
  }
  return {parse:parse, valid:valid, system:system, arrange:arrange};
}));
