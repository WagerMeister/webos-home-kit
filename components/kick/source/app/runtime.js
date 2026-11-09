/* Native app <-> loopback replay handoff; account credentials never cross it. */
var KickRuntime = (function () {
  'use strict';
  var keys = ['kick-accessibility', 'kick-channel', 'kick-favorites', 'kick-quality-preference', 'kick-recent-channels', 'kick-watched-videos', 'kick-browse-mode', 'kick-speed-preference'];
  var browser = location.protocol === 'http:' && location.hostname === '127.0.0.1' && location.port === '18427';
  var prefix = browser ? location.pathname.match(/^\/([a-f0-9]{32})\//) : null;
  var token = prefix ? prefix[1] : '', base = '/' + token + '/', initial = null, finished = false;
  var state = { position: 0, duration: 0, rate: 1 }, NativeBridge = typeof PalmServiceBridge === 'function' ? PalmServiceBridge : null;
  var opening = null, lastKey = 0, lastError = '';
  var ready = !browser, readyCallbacks = [], polling = false, keySequence = 0;
  function whenReady(callback) { if (ready) callback(); else readyCallbacks.push(callback); }
  function pollKeys() {
    if (!browser || !ready || finished || document.hidden || polling) return;
    polling = true;
    var xhr = new XMLHttpRequest(), ended = false;
    function next(delay) { if (ended) return; ended = true; polling = false; setTimeout(pollKeys, delay); }
    xhr.open('POST', base + 'keys', true); xhr.timeout = 2500;
    xhr.setRequestHeader('Content-Type', 'application/json'); xhr.setRequestHeader('X-Kick-Session', token);
    xhr.onload = function () {
      try {
        if (xhr.status !== 200) throw Error('Keyboard relay unavailable');
        var value = JSON.parse(xhr.responseText);
        (value.keys || []).slice(0, 16).forEach(function (item) {
          if (item.seq <= keySequence || !ready || finished || document.hidden) return;
          keySequence = item.seq;
          var target = document.activeElement || document.body, event = document.createEvent('Event');
          event.initEvent('keydown', true, true);
          Object.defineProperty(event, 'keyCode', { value: item.key }); Object.defineProperty(event, 'which', { value: item.key });
          target.dispatchEvent(event);
          // Synthetic keyboard events have no browser default button action.
          if (!event.defaultPrevented && item.key === 13 && target.tagName === 'BUTTON' && !target.disabled) target.click();
        });
        next(10);
      } catch (error) { next(250); }
    };
    xhr.onerror = xhr.ontimeout = function () { next(250); };
    try { xhr.send(JSON.stringify({ fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement) })); }
    catch (error) { next(250); }
  }
  function prepareScreen() {
    var ru = typeof KickI18n !== 'undefined' && KickI18n.detect({ navigator: navigator }) === 'ru';
    var button = document.createElement('button'); button.type = 'button'; button.id = 'accelerated-start';
    button.textContent = (ru ? 'Нажмите OK — запись на ' : 'Press OK — replay at ') + (initial && initial.rate || 1) + '×';
    document.body.appendChild(button); button.focus();
    function fullscreen() {
      if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
        if (ready) {
          ready = false;
          // Home/visibility changes take precedence over a fullscreen exit.
          setTimeout(function () { if (!finished) sync(document.hidden ? 'hidden' : 'back', false); }, 200);
        }
        return;
      }
      if (ready) return;
      ready = true; document.body.removeChild(button); document.documentElement.classList.add('accelerated-player');
      var callbacks = readyCallbacks; readyCallbacks = []; callbacks.forEach(function (callback) { callback(); }); pollKeys();
    }
    button.onclick = function () {
      var root = document.documentElement, request = root.requestFullscreen || root.webkitRequestFullscreen;
      try {
        var result = request.call(root);
        if (result && result.catch) result.catch(function () { button.textContent = ru ? 'Нажмите OK ещё раз для полноэкранного просмотра' : 'Press OK again to enter fullscreen'; });
      } catch (error) { button.textContent = ru ? 'Нажмите OK ещё раз для полноэкранного просмотра' : 'Press OK again to enter fullscreen'; }
    };
    // A real press on this window supplies the required user gesture. Never
    // inject a global ENTER after an asynchronous foreground query.
    document.addEventListener('fullscreenchange', fullscreen); document.addEventListener('webkitfullscreenchange', fullscreen);
  }
  function diagnostics() { var v=document.querySelector('video');return {key:lastKey,focus:document.activeElement&&document.activeElement.id||'',hidden:document.hidden,paused:v?!!v.paused:true,ready:v?v.readyState:0,error:lastError,status:document.getElementById('playback-status')?document.getElementById('playback-status').textContent.slice(0,240):'',at:performance.now(),time:v?v.currentTime:0,rate:v?v.playbackRate:1,width:v?v.videoWidth:0,height:v?v.videoHeight:0,fullscreen:!!(document.fullscreenElement||document.webkitFullscreenElement)}; }
  function preferences() {
    var out = {}; keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } }); return out;
  }
  function post(route, payload, callback, sync) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', base + route, !sync); xhr.setRequestHeader('Content-Type', 'application/json'); xhr.setRequestHeader('X-Kick-Session', token);
    xhr.onreadystatechange = function () { if (xhr.readyState === 4 && callback) { var data; try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; } callback(data); } };
    try { xhr.send(JSON.stringify(payload)); } catch (e) { if (callback) callback(null); }
    return xhr;
  }
  function bridgeCall(method, payload, callback) {
    if (!NativeBridge) { callback(null); return; }
    var bridge = new NativeBridge(), ended = false;
    var timer = setTimeout(function () { finish(null); }, 12000);
    function finish(value) {
      if (ended) return; ended = true; clearTimeout(timer); bridge.onservicecallback = function () {};
      try { bridge.cancel(); } catch (e) { /* Done. */ } callback(value);
    }
    bridge.onservicecallback = function (value) { var data; try { data = JSON.parse(value); } catch (e) { data = null; } finish(data); };
    try { bridge.call('luna://com.jakubjirak.service/' + method, JSON.stringify(payload)); } catch (e) { finish(null); }
  }
  function sync(reason, synchronous) {
    if (!browser || !token || finished) return;
    var payload = { preferences: preferences(), position: state.position, duration: state.duration, rate: state.rate, reason: reason, diagnostics: diagnostics() };
    if (reason !== 'progress') finished = true;
    return post('sync', payload, null, synchronous);
  }
  if (browser && token) {
    var xhr = new XMLHttpRequest(); xhr.open('GET', base + 'session', false); xhr.send();
    if (xhr.status === 200) {
      var config = JSON.parse(xhr.responseText); initial = config.initial;
      keys.forEach(function (key) { try { if (config.preferences[key] === null) localStorage.removeItem(key); else localStorage.setItem(key, config.preferences[key]); } catch (e) { /* Keep this session usable. */ } });
      state.position = initial.position; state.rate = initial.rate;
    }
    window.PalmServiceBridge = function () {
      var self = this, request = null, cancelled = false;
      this.call = function (uri, payload) {
        if (uri.indexOf('luna://com.jakubjirak.service/') !== 0) throw Error('Unsupported service');
        var method = uri.slice('luna://com.jakubjirak.service/'.length);
        request = post('api/' + method, JSON.parse(payload), function (value) { if (!cancelled && self.onservicecallback) self.onservicecallback(JSON.stringify(value || { returnValue: false })); });
      };
      this.cancel = function () { cancelled = true; if (request) request.abort(); };
    };
    // Parser-time loading keeps the native app lightweight; only the browser
    // replay context needs the MSE library. All code is packaged locally.
    document.write('<script src="vendor/hls.light.min.js"><\/script>');
    document.addEventListener('keydown',function(e){lastKey=e.keyCode;setTimeout(function(){sync('progress',false);},0);},true);
    window.addEventListener('error',function(e){lastError=String((e.message||'Script error')+' '+(e.filename||'')+':'+(e.lineno||0)).slice(0,200);sync('progress',false);});
    setInterval(function () { if (!document.hidden) sync('progress', false); }, 10000);
    document.addEventListener('DOMContentLoaded', prepareScreen);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollKeys(); });
  }
  return { browser: browser, initial: initial, remotePlayback: true, whenReady: whenReady,
    update: function (value, rate) { if(finished||value.phase==='idle')return;state.position = Math.max(0, Math.min(2592000, value.position || 0)); state.duration = Math.max(0, Math.min(2592000, value.duration || 0)); state.rate = rate || state.rate; },
    finish: function () { sync('back', false); },
    hidden: function () { sync('hidden', true); },
    cancelOpen: function (hidden) {
      if(!opening)return;
      if(hidden&&opening.dispatched){if(opening.id)bridgeCall('browserCancel',{id:opening.id,unlessBrowser:true},function(){});return;}
      opening.cancelled=true;if(opening.id)bridgeCall('browserCancel',{id:opening.id},function(){});
    },
    open: function (item, rate, position, callback, valid) {
      var work={id:null,cancelled:false,dispatched:false};opening=work;
      bridgeCall('browserReplay', { channel: item.channel, video: item.id, position: position || 0, rate: rate, preferences: preferences() }, function (value) {
        if (!value || value.returnValue !== true || !/^[a-f0-9]{32}$/.test(value.id || '')) { callback(false); return; }
        work.id=value.id;
        if(work.cancelled||valid&&!valid()){bridgeCall('browserCancel',{id:value.id},function(){});callback(false);return;}
        try { localStorage.setItem('kick-browser-pending', value.id); } catch (e) { callback(false); return; }
        work.dispatched=true;
        bridgeCall('browserLaunch', { id: value.id }, function (launched) { if(opening===work)opening=null;callback(!!(launched && launched.returnValue)); });
      });
    },
    collect: function (callback, retry) {
      if (browser) { callback(null); return; }
      var id; try { id = localStorage.getItem('kick-browser-pending'); } catch (e) { callback(null); return; }
      if (!/^[a-f0-9]{32}$/.test(id || '')) { callback(null); return; }
      bridgeCall('browserResult', { id: id }, function (value) {
        if (value && value.returnValue && value.result && !value.result.done && (retry || 0) < 12) {
          setTimeout(function () { KickRuntime.collect(callback, (retry || 0) + 1); }, 250); return;
        }
        if (!value || !value.returnValue || !value.result || !value.result.done) { callback(null); return; }
        try {
          keys.forEach(function (key) {
            if (localStorage.getItem(key) !== value.baseline[key]) return;
            var next = value.result.preferences[key];
            if (typeof next === 'string') localStorage.setItem(key, next); else if (next === null) localStorage.removeItem(key);
          });
          localStorage.removeItem('kick-browser-pending');
        } catch (e) { /* Do not delete unrelated preferences. */ }
        callback(value);
      });
    }
  };
}());
