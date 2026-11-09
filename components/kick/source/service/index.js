'use strict';
var https = require('https');
var zlib = require('zlib');
var Service = typeof global !== 'undefined' && global.KICK_BROWSER_CONTEXT ? global.KICK_BROWSER_CONTEXT.Service : require('webos-service');
var service = new Service('com.jakubjirak.service');
var pending = Object.create(null);
var activeRequests = 0;
// Reuse TLS connections between channel, replay and status lookups on the same host.
var agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 6, maxFreeSockets: 2 });
// maxFreeSockets is per origin. Channel-specific CDN hosts must not grow the idle pool.
agent.on('free', function () {
  var free = [];
  Object.keys(agent.freeSockets).forEach(function (origin) {
    agent.freeSockets[origin].forEach(function (socket) { if (!socket.destroyed) free.push(socket); });
  });
  for (var i = 0; i < free.length - 2; i++) free[i].destroy();
});

function titleText(value, fallback) {
  var text = String(value || fallback || '');
  // Some TV builds omit ICU normalization; keep readable text on those builds.
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  // Node 0.12 has no Array.from. Count code points without splitting emoji.
  var end = 0, count = 0;
  while (end < text.length && count < 200) {
    var first = text.charCodeAt(end++), second = text.charCodeAt(end);
    if (first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF) end++;
    count++;
  }
  return text.slice(0, end);
}

// Errors carry a stable code that the app translates; the message is an English fallback.
function failure(code, message, params) {
  var error = new Error(message);
  error.code = code;
  error.params = params || {};
  return error;
}

function errorReply(error) {
  // Only failure() errors carry a code; any other exception maps to a fixed internal code.
  var known = error && typeof error.code === 'string' && error.params;
  return { returnValue: false, errorCode: known ? error.code : 'internal', errorParams: known ? error.params : {},
    errorText: known ? error.message : 'The data from Kick could not be processed.' };
}

function respond(message, data) {
  try { message.respond(data); } catch (e) { /* The requesting app may have closed. */ }
}

function imageURL(value) {
  if (value && typeof value === 'object') value = value.src || value.url;
  return typeof value === 'string' && value.length < 2048 &&
    /^https:\/\/(?:files|images)\.kick\.com\/[^\s#]+$/.test(value) ? value : '';
}

function mediaURL(value) {
  return typeof value === 'string' && value.length < 4096 &&
    /^https:\/\/(?:stream\.kick\.com|(?:[a-z0-9-]+\.)+live-video\.net)\/[^\s?#]+\.m3u8(?:\?[^\s#]*)?$/.test(value) ? value : '';
}

function getText(hostname, path, background) {
  var key = hostname + path;
  if (pending[key]) return pending[key];
  // Background status checks leave two request slots for opening a channel/video.
  if (activeRequests >= (background ? 4 : 6)) return Promise.reject(failure('busy', 'Another request is in progress. Try again shortly.'));
  activeRequests++;
  var work = new Promise(function (resolve, reject) {
    var completed = false, retried = false;
    var timer, req = null, inflater = null;
    function finish(error, data) {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (inflater && typeof inflater.destroy === 'function') { try { inflater.destroy(); } catch (e) { /* Already destroyed. */ } }
      if (error) {
        if (req) req.abort();
        reject(error);
      } else resolve(data);
    }
    function attempt() {
      var responded = false;
      // No caller-supplied host, redirects, credentials, or disabled TLS checks.
      req = https.get({ hostname: hostname, path: path, agent: retried ? false : agent,
        headers: hostname === 'api.github.com' ? { Accept: 'application/vnd.github+json', 'User-Agent': 'Stream-for-Kick-webOS', 'X-GitHub-Api-Version': '2026-03-10', 'Accept-Encoding': 'gzip' } : { Accept: '*/*', 'Accept-Encoding': 'gzip', 'Cache-Control': 'no-cache' } }, function (res) {
        responded = true;
        if (res.statusCode !== 200) {
          var retryAt = 0;
          if (hostname === 'api.github.com' && res.headers) {
            var after = Number(res.headers['retry-after']), reset = Number(res.headers['x-ratelimit-reset']) * 1000;
            if (isFinite(after) && after > 0) retryAt = Date.now() + after * 1000;
            if (isFinite(reset) && reset > retryAt) retryAt = reset;
          }
          finish(failure('http', 'Kick API: HTTP ' + res.statusCode, { status: res.statusCode, retryAt: retryAt }));
          return;
        }
        var encoding = String(res.headers && res.headers['content-encoding'] || '').trim().toLowerCase();
        var body = '', bytes = 0;
        var stream = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          // Compressed transfers are inflated incrementally with backpressure; the 1 MiB limit applies to inflated text.
          inflater = stream = zlib.createGunzip();
          inflater.on('error', function () { finish(failure('decode', 'The response from Kick could not be decoded.')); });
          res.pipe(inflater);
        } else if (encoding && encoding !== 'identity') {
          finish(failure('decode', 'Unsupported content encoding.'));
          return;
        }
        stream.setEncoding('utf8');
        stream.on('data', function (chunk) {
          if (completed) return;
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > 1048576) {
            finish(failure('too_large', 'The response from Kick is too large.'));
          } else body += chunk;
        });
        res.on('error', function (error) { finish(failure('transfer', error && error.message || 'Transfer failed.')); });
        res.on('aborted', function () { finish(failure('aborted', 'The transfer was interrupted. Try again.')); });
        stream.on('end', function () {
          finish(null, body);
        });
      });
      req.on('error', function (error) {
        // A kept-alive socket may have been closed by the server; retry once on a fresh connection.
        var reset = error && (error.code === 'ECONNRESET' || error.code === 'EPIPE' || error.message === 'socket hang up');
        if (!completed && !responded && !retried && reset) { retried = true; attempt(); return; }
        finish(failure('connect', 'Could not connect to Kick.'));
      });
    }
    attempt();
    timer = setTimeout(function () {
      finish(failure('timeout', 'Kick did not respond in time. Try again.'));
    }, 12000);
  });
  pending[key] = work.then(function (data) {
    activeRequests--; delete pending[key]; return data;
  }, function (error) {
    activeRequests--; delete pending[key]; throw error;
  });
  return pending[key];
}

function getJSON(path, background) {
  return getText('kick.com', '/api/v2/channels/' + path, background).then(function (body) {
    try { return JSON.parse(body); }
    catch (e) { throw failure('invalid_data', 'Kick returned invalid data.'); }
  });
}

service.register('statuses', function (message) {
  var channels = message.payload && message.payload.channels;
  if (!Array.isArray(channels) || !channels.length || channels.length > 6 || channels.some(function (name, i) {
    return typeof name !== 'string' || !/^[a-z0-9_-]{1,25}$/.test(name) || channels.indexOf(name) !== i;
  })) {
    respond(message, errorReply(failure('invalid_channels', 'Invalid channel list.'))); return;
  }
  var next = 0, statuses = [];
  function worker() {
    var index = next++;
    if (index >= channels.length) return Promise.resolve();
    var name = channels[index];
    return getJSON(name, true).then(function (channel) {
      if (!channel || channel.slug !== name) throw new Error('channel');
      statuses[index] = { channel: name, live: !!(channel.livestream && channel.livestream.is_live === true) };
    }).catch(function () { statuses[index] = { channel: name, live: null }; }).then(worker);
  }
  Promise.all([worker(), worker()]).then(function () {
    respond(message, { returnValue: true, statuses: statuses });
  }).catch(function () { respond(message, errorReply(failure('statuses_unavailable', 'Channel status is not available.'))); });
});

service.register('prepare', function (message) {
  var source = mediaURL(message.payload && message.payload.url);
  if (!source) {
    respond(message, errorReply(failure('bad_url', 'Video address not allowed.')));
    return;
  }
  // Split only after the exact HTTPS host allowlist has accepted the source.
  // Avoid WHATWG URL (absent in Node 0.12) and legacy parser host ambiguities.
  var parts = source.match(/^https:\/\/([^/]+)(\/.*)$/), path;
  try {
    // Encode unsafe characters once, preserving signed query strings and existing escapes.
    path = encodeURI(parts[2]).replace(/%25([a-f0-9]{2})/gi, '%$1');
  } catch (e) {
    respond(message, errorReply(failure('bad_url', 'Video address not allowed.')));
    return;
  }
  getText(parts[1], path).then(function (body) {
    if (body.trim().indexOf('#EXTM3U') !== 0) throw failure('bad_playlist', 'Invalid video playlist.');
    var variants = [], lines = body.split(/\r?\n/), audio = Object.create(null);
    lines.forEach(function (line) {
      if (line.indexOf('#EXT-X-MEDIA:') !== 0 || !/(?:[:,])TYPE=AUDIO(?:,|$)/.test(line)) return;
      var group = line.match(/(?:[:,])GROUP-ID="([^"]{1,128})"/);
      if (group) audio[group[1]] = audio[group[1]] === false || /(?:[:,])URI=/.test(line) ? false : true;
    });
    function variantURL(value) {
      if (!value || value.length >= 4096 || /[\s\\#]/.test(value)) return '';
      if (/^https:\/\//.test(value)) return mediaURL(value);
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return '';
      var relative = value.charAt(0) === '/' ? value : parts[2].split('?')[0].replace(/[^/]*$/, '') + value;
      var query = relative.indexOf('?'), suffix = query < 0 ? '' : relative.slice(query);
      var segments = (query < 0 ? relative : relative.slice(0, query)).split('/'), normalized = [];
      segments.forEach(function (part) { if (part === '..') normalized.pop(); else if (part && part !== '.') normalized.push(part); });
      return mediaURL('https://' + parts[1] + '/' + normalized.join('/') + suffix);
    }
    for (var i = 0; i < lines.length && variants.length < 64; i++) {
      var line = lines[i];
      if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var size = line.match(/(?:[:,])RESOLUTION=(\d+)x(\d+)/);
      var bps = line.match(/(?:[:,])BANDWIDTH=(\d+)/);
      var fps = line.match(/(?:[:,])FRAME-RATE=([\d.]+)/), group = line.match(/(?:[:,])AUDIO="([^"]{1,128})"/);
      var next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      var url = next < lines.length ? variantURL(lines[next].trim()) : '';
      if (size && bps && +size[1] > 0 && +size[2] > 0 && +bps[1] > 0 && +bps[1] <= 200000000 && +size[1] <= 3840 && +size[2] <= 2160 && url) {
        var rate = fps ? +fps[1] : 0;
        if (!variants.some(function (v) { return v.url === url; })) variants.push({ width: +size[1], height: +size[2], bitrate: +bps[1],
          fps: isFinite(rate) && rate > 0 && rate <= 240 ? rate : 0, url: url, manual: !/(?:[:,])AUDIO=/.test(line) || !!group && (line.match(/(?:[:,])AUDIO=/g) || []).length === 1 && audio[group[1]] === true });
      }
    }
    variants.sort(function (a, b) { return b.height - a.height || b.width - a.width || b.fps - a.fps || b.bitrate - a.bitrate; });
    respond(message, { returnValue: true, best: variants[0] || null, variants: variants });
  }).catch(function (e) { respond(message, errorReply(e)); });
});

function publicVideos(recordings, identity) {
  return Array.isArray(recordings) ? recordings.filter(function (v) {
      return v && !v.is_live && v.video && v.video.is_private === false &&
        !v.video.deleted_at && !v.video.is_pruned && v.video.status === 'public' && mediaURL(v.source) &&
        (!identity || String(v.video.uuid || v.video.id || v.id || '') === identity);
    }).slice(0, identity ? 1 : 30).map(function (v) {
      var length = Number(v.duration);
      var id = String(v.video.uuid || v.video.id || v.id || '');
      // An empty title lets the app supply its localized "Replay" label.
      return { id: /^[a-z0-9-]{1,64}$/.test(id) ? id : '', title: titleText(v.session_title, ''),
        url: mediaURL(v.source), date: String(v.created_at || '').slice(0, 10),
        thumbnail: imageURL(v.thumbnail),
        duration: isFinite(length) && length > 0 ? Math.min(length / 1000, 2592000) : 0 };
    }) : [];
}

service.register('replay', function (message) {
  var payload = message.payload || {}, slug = payload.channel, id = payload.id;
  if (typeof slug !== 'string' || !/^[a-z0-9_-]{1,25}$/.test(slug) || typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) {
    respond(message, errorReply(failure('invalid_replay', 'Invalid replay identity.'))); return;
  }
  getJSON(slug + '/videos', payload.background === true).then(function (recordings) {
    if (!Array.isArray(recordings)) throw failure('videos_unavailable', 'The replay list is not available.');
    var found = publicVideos(recordings, id)[0];
    respond(message, { returnValue: true, video: found || null });
  }).catch(function (error) { respond(message, errorReply(error)); });
});

service.register('channel', function (message) {
  var slug = message.payload && message.payload.channel;
  if (typeof slug !== 'string' || !/^[a-z0-9_-]{1,25}$/.test(slug)) {
    respond(message, errorReply(failure('invalid_channel', 'Invalid channel name.')));
    return;
  }
  // A private marker distinguishes an internal replay-list failure from any object Kick might return.
  var failedVideos = {};
  Promise.all([getJSON(slug), getJSON(slug + '/videos').catch(function (e) {
    return { marker: failedVideos, error: e };
  })]).then(function (results) {
    var channel = results[0];
    if (!channel || channel.slug !== slug) throw failure('wrong_channel', 'Kick did not return the requested channel.');
    var live = channel.livestream;
    var source = mediaURL(channel.playback_url);
    var recordings = results[1];
    var videos = publicVideos(recordings);
    var videosError = Array.isArray(recordings) ? null :
      recordings && recordings.marker === failedVideos ? recordings.error : failure('videos_unavailable', 'The replay list is not available.');
    respond(message, { returnValue: true, channel: slug,
      live: live && live.is_live === true && source ? {
        title: titleText(live.session_title, slug), url: source, isLive: true
      } : null,
      videos: videos,
      videosError: videosError ? errorReply(videosError) : null });
  }).catch(function (e) {
    respond(message, errorReply(e));
  });
});

  function versionParts(value) {
    var match = typeof value === 'string' && value.length <= 96 && value.match(/^v?((?:0|[1-9][0-9]{0,3}))\.((?:0|[1-9][0-9]{0,3}))\.((?:0|[1-9][0-9]{0,3}))(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
    return match ? [+match[1], +match[2], +match[3]] : null;
  }
  function compareVersions(a, b) {
    a = versionParts(a); b = versionParts(b);
    if (!a || !b) return null;
    for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
  }
var updateCache = null, updateCacheUntil = 0, updateRetryAt = 0;
service.register('updates', function (message) {
  var now = Date.now();
  if (updateCache && now < updateCacheUntil) { respond(message, { returnValue: true, release: updateCache, cached: true }); return; }
  if (now < updateRetryAt) { respond(message, { returnValue: false, errorCode: 'updates_unavailable', retryAt: updateRetryAt }); return; }
  getText('api.github.com', '/repos/JirakJ/kick-web-os-app/releases/latest').then(function (body) {
    // GitHub's stable-specific endpoint is independent of prerelease/pagination windows.
    var selected = JSON.parse(body);
    if (!selected || selected.draft !== false || selected.prerelease !== false || !versionParts(selected.tag_name) ||
      selected.html_url !== 'https://github.com/JirakJ/kick-web-os-app/releases/tag/' + selected.tag_name) throw new Error('stable release');
    updateCache = { version: selected.tag_name.replace(/^v/, ''), url: selected.html_url,
      notes: typeof selected.body === 'string' ? titleText(selected.body, '') : '', checkedAt: Date.now() };
    updateCacheUntil = Date.now() + 21600000; updateRetryAt = 0;
    respond(message, { returnValue: true, release: updateCache, cached: false });
  }).catch(function (error) {
    var params = error && error.params, limited = params && (params.status === 403 || params.status === 429);
    updateRetryAt = Math.max(Date.now() + (limited ? 21600000 : 60000), params && typeof params.retryAt === 'number' && isFinite(params.retryAt) ? params.retryAt : 0);
    respond(message, { returnValue: false, errorCode: 'updates_unavailable', retryAt: updateRetryAt });
  });
});

require("./discovery").register(service, { get: getText, title: titleText, image: imageURL, respond: respond, error: errorReply, failure: failure });

if (typeof global === 'undefined' || !global.KICK_BROWSER_CONTEXT) require("./browser-session").register(service);
