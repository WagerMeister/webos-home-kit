/* Native webOS media lifecycle. No network proxy or browser player library. Status messages are i18n keys. */
function KickPlayer(host, events) {
  'use strict';
  var mse = null, speed = 1;
  var browserMSE = typeof KickRuntime !== 'undefined' && KickRuntime.browser;
  var media = null, listeners = [], item = null, epoch = 0, ready = false;
  var wantPlay = false, phase = 'idle', position = 0, duration = 0;
  var queuedSeek = null, activeSeek = null, seekTimer, deadline, deadlineAt = 0, retryTimer;
  var network = false, refreshing = false;
  var retries = 0, healthySince = 0, playPending = false, playAttempt = 0;

  function validURL(url) {
    return typeof url === 'string' && url.length < 4096 &&
      /^https:\/\/(?:stream\.kick\.com|(?:[a-z0-9-]+\.)+live-video\.net)\/[^\s?#]+\.m3u8(?:\?[^\s#]*)?$/.test(url);
  }
  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function target() { return queuedSeek !== null ? queuedSeek : activeSeek !== null ? activeSeek : position; }
  function state() {
    return { phase: phase, paused: !wantPlay, ready: ready, position: target(), duration: duration,
      network: network, isLive: !!(item && item.isLive), seeking: queuedSeek !== null || activeSeek !== null };
  }
  function changed() { events.change(state()); }
  function status(key, params) { events.status(key, params); }
  function now() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
  function clearDeadline() { clearTimeout(deadline); deadline = null; deadlineAt = 0; }
  function checkDeadline() {
    deadline = null;
    var remaining = deadlineAt - now();
    if (remaining > 0) deadline = setTimeout(checkDeadline, remaining);
    else recover('p_stalled');
  }
  function armDeadline() {
    deadlineAt = now() + 20000;
    if (!deadline) deadline = setTimeout(checkDeadline, 20000);
  }
  function dispose() {
    epoch++;
    refreshing = false; if (events.cancelRefresh) events.cancelRefresh();
    playAttempt++;
    clearDeadline(); clearTimeout(seekTimer); clearTimeout(retryTimer);
    seekTimer = retryTimer = null;
    ready = false; playPending = false; activeSeek = queuedSeek = null;
    if (mse) { mse.destroy(); mse = null; }
    var previous = media, previousListeners = listeners;
    media = null; listeners = [];
    if (previous) previousListeners.forEach(function (listener) {
      previous.removeEventListener(listener.name, listener.callback);
    });
    if (previous) {
      try { previous.pause(); } catch (e) { /* Still clear a failed native decoder. */ }
      var cleared = false;
      try {
        previous.removeAttribute('src');
        while (previous.firstChild) previous.removeChild(previous.firstChild);
        cleared = true;
      } catch (e) { /* Still detach a failed native decoder. */ }
      if (previous.parentNode === host) host.removeChild(previous);
      // On webOS 5, removing media after an empty load retains native pending activity.
      if (cleared) try { previous.load(); } catch (e) { /* The failed decoder is already detached. */ }
    }
  }
  function networkRetry(manual, resume) {
    if (!item || document.hidden) return;
    if (manual && resume) wantPlay = true;
    if (retryTimer || refreshing) { changed(); return; }
    if (manual) retries = 0;
    position = target(); dispose(); healthySince = 0; network = true;
    if (navigator.onLine === false) { phase = 'offline'; status('p_offline'); changed(); return; }
    if (!manual && !wantPlay) { phase = 'paused'; changed(); return; }
    if (retries >= 2) { phase = 'error'; status('p_network_final'); changed(); return; }
    retries++; phase = 'reconnecting'; status('p_reconnecting', { attempt: retries }); changed();
    var token = epoch;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (token !== epoch || !item || document.hidden || !events.refresh) return;
      refreshing = true;
      events.refresh(function (value, unavailable) {
        if (token !== epoch || !item || document.hidden || !refreshing) return;
        refreshing = false;
        if (value && validURL(value.url)) { item.url = value.url; item.best = value.best; network = false; mount(); }
        else if (unavailable) { phase = 'error'; status('p_content_unavailable'); changed(); }
        else if (!wantPlay) { phase = 'error'; status('p_network_final'); changed(); }
        else networkRetry(false, false);
      });
    }, retries === 1 ? 600 : 1800);
  }
  function offline() {
    if (!item || phase === 'ended' || document.hidden) return;
    if (events.refresh) {
      position = target(); dispose(); network = true; phase = 'offline'; status('p_offline'); changed();
    }
  }
  function online() { if (network && phase === 'offline' && wantPlay) networkRetry(false, false); }
  function recover(reason, params) {
    if (!item || retryTimer || refreshing || phase === 'error' || phase === 'ended' || document.hidden) return;
    if (events.refresh && (navigator.onLine === false || reason === 'p_stalled' || reason === 'p_live_interrupted' || reason === 'p_media_error' && params && params.code === 2)) { networkRetry(false, false); return; }
    position = target();
    dispose(); healthySince = 0;
    if (navigator.onLine === false) {
      phase = 'error'; wantPlay = false;
      status('p_offline'); changed(); return;
    }
    if (retries >= 2) {
      phase = 'error'; wantPlay = false;
      status('p_failed_final', { reason: reason, reasonParams: params }); changed(); return;
    }
    retries++; phase = 'recovering';
    status('p_recovering', { attempt: retries }); changed();
    var token = epoch;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (token === epoch && item && !document.hidden) mount();
    }, 600);
  }
  function requestPlay() {
    if (!media || playPending) return;
    // A native play promise can outlive disposal; do not capture its video.
    var token = epoch, attempt = ++playAttempt;
    playPending = true;
    try {
      var result = media.play();
      if (result && result.then) result.then(function () {
        if (token === epoch && attempt === playAttempt) playPending = false;
      }, function (error) {
        if (token !== epoch || attempt !== playAttempt) return;
        playPending = false;
        if (!wantPlay || error && error.name === 'AbortError') return;
        if (error && error.name === 'NotAllowedError') {
          wantPlay = false; phase = 'paused'; clearDeadline();
          status('p_press_ok'); changed();
        } else recover('p_play_failed');
      });
      else playPending = false;
    } catch (e) { playPending = false; recover('p_play_failed'); }
  }
  function commitSeek() {
    clearTimeout(seekTimer);
    seekTimer = null;
    if (!media || !ready || activeSeek !== null || queuedSeek === null || media.seeking) return;
    activeSeek = queuedSeek; queuedSeek = null; phase = 'seeking';
    status('p_seeking'); changed(); armDeadline();
    try { media.currentTime = activeSeek; }
    catch (e) { recover('p_seek_failed'); }
  }
  function mount() {
    if (!item || document.hidden) return;
    position = target();
    dispose();
    phase = 'loading'; status('p_loading');
    var node = document.createElement('video');
    node.id = 'video'; node.preload = 'auto'; node.setAttribute('playsinline', '');
    media = node;
    var token = epoch, startPending = !item.isLive && position > 0;
    function on(name, callback) {
      var listener = function () {
        if (node === media && token === epoch && item) callback();
      };
      listeners.push({ name: name, callback: listener });
      node.addEventListener(name, listener);
    }
    on('loadedmetadata', function () {
      if (finite(node.duration) && node.duration > 0) duration = node.duration;
      changed();
    });
    on('loadeddata', function () {
      ready = true;
      if (!wantPlay) { node.pause(); phase = 'paused'; clearDeadline(); status(''); }
      if (queuedSeek !== null) commitSeek();
      changed();
    });
    on('playing', function () {
      ready = true; playPending = false;
      if (!wantPlay) { node.pause(); phase = 'paused'; clearDeadline(); changed(); return; }
      if (browserMSE) node.playbackRate = item.isLive ? 1 : speed;
      phase = activeSeek === null ? 'playing' : 'seeking';
      if (activeSeek === null) status('');
      if (!healthySince) healthySince = now();
      armDeadline(); changed();
    });
    on('timeupdate', function () {
      if (activeSeek === null && finite(node.currentTime)) {
        // webOS can report zero before acknowledging a paused native playTime start.
        // Keep that requested position across further source changes and suspension.
        if (startPending && node.currentTime <= 0) return;
        startPending = false;
        var delta = node.currentTime - position;
        var advanced = Math.abs(delta) > 0.05;
        position = Math.max(0, node.currentTime);
        if (advanced && wantPlay && !node.paused) {
          phase = 'playing'; status(''); armDeadline();
          if (healthySince && now() - healthySince >= 30000) retries = 0;
          if (!item.isLive && delta > 0 && !node.seeking && queuedSeek === null && events.progress) {
            events.progress(position, duration, false);
          }
        }
      }
      changed();
    });
    on('durationchange', function () {
      if (finite(node.duration) && node.duration > 0) duration = node.duration;
      changed();
    });
    on('seeked', function () {
      if (activeSeek !== null) { position = activeSeek; startPending = false; }
      activeSeek = null;
      clearDeadline(); phase = wantPlay ? 'playing' : 'paused'; status('');
      if (!wantPlay) node.pause(); else armDeadline();
      changed();
      if (queuedSeek !== null) commitSeek();
    });
    on('pause', changed);
    on('waiting', function () {
      healthySince = 0;
      if (wantPlay || activeSeek !== null) {
        phase = activeSeek === null ? 'buffering' : 'seeking';
        status(activeSeek === null ? 'p_loading' : 'p_seeking');
        if (!deadline) armDeadline();
        changed();
      }
    });
    on('error', function () { recover('p_media_error', { code: node.error && typeof node.error.code === 'number' ? node.error.code : '?' }); });
    on('ended', function () {
      if (item.isLive) { recover('p_live_interrupted'); return; }
      wantPlay = false; phase = 'ended'; position = duration;
      if (events.progress) events.progress(position, duration, true);
      clearDeadline(); status('p_ended'); changed();
    });
    on('click', function () { if (events.interact) events.interact(); });
    try {
      node.muted = false; node.volume = 1;
      if (browserMSE) {
        if (typeof Hls !== 'function' || !Hls.isSupported()) throw Error('MSE unavailable');
        host.appendChild(node);
        mse = new Hls({ enableWorker:false, startPosition:position, maxBufferLength:15, maxMaxBufferLength:30, backBufferLength:10, lowLatencyMode:false });
        mse.on(Hls.Events.ERROR, function (event, error) { if (error.fatal && node === media && token === epoch) recover('p_media_error', {code:error.details}); });
        mse.attachMedia(node); mse.loadSource(item.url); node.playbackRate = item.isLive ? 1 : speed;
        armDeadline(); changed(); if (wantPlay) requestPlay(); return;
      }
      var source = document.createElement('source');
      var best = item.best;
      var options = { mediaTransportType: 'HLS', option: {
        adaptiveStreaming: { maxWidth: 3840, maxHeight: 2160, adaptiveResolution: true,
          bps: { start: best && finite(best.bitrate) && best.bitrate > 0 ? best.bitrate : 40000000 } }
      } };
      if (!item.isLive && position > 0) options.option.transmission = { playTime: { start: Math.round(position * 1000) } };
      source.setAttribute('src', item.url);
      source.setAttribute('type', 'application/x-mpegurl;mediaOption=' + encodeURI(JSON.stringify(options)));
      node.appendChild(source); host.appendChild(node); node.load();
      armDeadline(); changed();
      if (wantPlay) requestPlay();
    } catch (e) { recover('p_mount_failed'); }
  }
  function stop() {
    item = null; wantPlay = false; network = false; dispose();
    position = duration = retries = healthySince = 0; phase = 'idle';
    status(''); changed();
  }
  function load(value) {
    stop();
    if (!value || !validURL(value.url)) { phase = 'error'; status('p_invalid_url'); changed(); return false; }
    item = value; duration = finite(value.duration) && value.duration > 0 ? value.duration : 0;
    position = finite(value.startAt) && value.startAt > 0 ? Math.min(value.startAt, duration ? Math.max(0, duration - 0.1) : 2592000) : 0;
    wantPlay = true; mount(); return true;
  }
  function changeSource(url, best) {
    if (!item || network || !validURL(url) || document.hidden) return false;
    position = target(); item.url = url; item.best = best; mount(); return true;
  }
  function play() {
    if (!item || document.hidden) return;
    if (network && events.refresh) { networkRetry(true, true); return; }
    wantPlay = true;
    if (phase === 'ended') position = 0;
    if (phase === 'error') retries = 0;
    if (!media && !retryTimer) mount(); else { requestPlay(); armDeadline(); changed(); }
  }
  function pause() {
    wantPlay = false;
    if (network) { position = target(); dispose(); phase = 'paused'; status('p_suspended'); changed(); return; }
    playAttempt++; playPending = false;
    if (media) { try { media.pause(); } catch (e) { recover('p_pause_failed'); } }
    if (activeSeek === null && ready) { clearDeadline(); phase = 'paused'; }
    changed();
  }
  function seekTo(value) {
    if (!item || item.isLive || !finite(value) || !duration || phase === 'error') return;
    queuedSeek = Math.max(0, Math.min(Math.max(0, duration - 0.1), value));
    clearTimeout(seekTimer); seekTimer = setTimeout(commitSeek, 300); changed();
  }
  function suspend() {
    position = target(); wantPlay = false; dispose(); phase = item ? 'paused' : 'idle';
    if (item) status('p_suspended');
    changed();
  }
  function setRate(value) {
    if ([1,1.25,1.5,1.75,2].indexOf(value)<0 || !browserMSE && value!==1) return false;
    speed=value; if(media && browserMSE) media.playbackRate=item&&item.isLive?1:speed; return true;
  }
  return { setRate:setRate, load: load, offline: offline, online: online, reconnect: function (resume) { if (events.refresh) networkRetry(true, !!resume); }, changeSource: changeSource, stop: stop, play: play, pause: pause, suspend: suspend, state: state,
    toggle: function () { if (wantPlay) pause(); else play(); },
    seekTo: seekTo, seekBy: function (seconds) { if (finite(seconds)) seekTo(target() + seconds); } };
}
if (typeof module !== 'undefined') module.exports = KickPlayer;
