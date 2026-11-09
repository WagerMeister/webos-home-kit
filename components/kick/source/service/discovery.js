'use strict';

// Only fixed first-party endpoints. Public UI inputs never select a host/path.
function options(payload) {
  payload = payload || {};
  var sort = payload.sort || 'popular', language = payload.language || 'ru';
  var cursor = payload.cursor || '', category = payload.category || 0;
  if (['popular', 'featured'].indexOf(sort) < 0 || ['ru', 'all'].indexOf(language) < 0 ||
      typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]*$/.test(cursor) ||
      typeof category !== 'number' || category < 0 || category > 2147483647 || category % 1) return null;
  return { sort: sort, language: language, cursor: cursor, category: category };
}

function pathFor(value) {
  return '/api/v1/livestreams?limit=6&sort=' + (value.sort === 'featured' ? 'featured' : 'viewer_count_desc') +
    (value.language === 'ru' ? '&language=ru' : '') +
    (value.category ? '&category_id=' + value.category : '') +
    (value.cursor ? '&after=' + encodeURIComponent(value.cursor) : '');
}

function register(service, api) {
  function card(value, legacy) {
    if (!value || typeof value !== 'object') return null;
    var stream = legacy ? value.livestream : value, channel = legacy ? value : value.channel;
    if (!stream || legacy && stream.is_live !== true || !channel || typeof channel.slug !== 'string' ||
        !/^[a-z0-9_-]{1,25}$/.test(channel.slug)) return null;
    var category = legacy ? stream.categories && stream.categories[0] : value.category;
    var viewers = stream.viewer_count;
    return { channel: channel.slug, title: api.title(stream.title || stream.session_title, channel.slug),
      thumbnail: api.image(stream.thumbnail), avatar: api.image(channel.profile_pic || channel.user && channel.user.profile_pic),
      language: typeof stream.language === 'string' ? stream.language.slice(0, 10) : '',
      viewers: stream.show_view_count !== false && typeof viewers === 'number' && isFinite(viewers) && viewers >= 0 ? Math.floor(viewers) : null,
      category: category && typeof category.id === 'number' && category.id > 0 ?
        { id: category.id, name: api.title(category.name, '') } : null };
  }

  service.register('directory', function (message) {
    var value = options(message.payload);
    if (!value) return api.respond(message, api.error(api.failure('invalid_directory', 'Invalid directory filter.')));
    api.get('web.kick.com', pathFor(value), true).then(function (text) {
      var data = JSON.parse(text).data;
      if (!data || !Array.isArray(data.livestreams)) throw api.failure('invalid_data', 'Kick returned invalid data.');
      var items = [], seen = Object.create(null);
      data.livestreams.slice(0, 6).forEach(function (item) {
        var result = card(item, false);
        if (result && !seen[result.channel]) { seen[result.channel] = true; items.push(result); }
      });
      var cursor = data.pagination && data.pagination.next_cursor;
      api.respond(message, { returnValue: true, items: items,
        nextCursor: typeof cursor === 'string' && cursor.length <= 256 && /^[A-Za-z0-9_-]+$/.test(cursor) ? cursor : '' });
    }).catch(function (error) { api.respond(message, api.error(error)); });
  });

  service.register('liveFavorites', function (message) {
    var names = message.payload && message.payload.channels;
    if (!Array.isArray(names) || names.length > 50 || names.some(function (name, index) {
      return typeof name !== 'string' || !/^[a-z0-9_-]{1,25}$/.test(name) || names.indexOf(name) !== index;
    })) return api.respond(message, api.error(api.failure('invalid_channels', 'Invalid favorite channel list.')));
    var next = 0, pending = 0, completed = 0, failed = 0, items = [], stopped = false;
    var timer = setTimeout(function () { finish(); }, 25000);
    if (typeof message.on === 'function') message.on('cancel', function () { stopped = true; clearTimeout(timer); });
    function finish() {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      items.sort(function (a, b) { return names.indexOf(a.channel) - names.indexOf(b.channel); });
      api.respond(message, { returnValue: true, items: items, incomplete: failed > 0 || completed < names.length });
    }
    function worker() {
      if (stopped) return;
      if (next >= names.length) { if (!pending) finish(); return; }
      var name = names[next++]; pending++;
      api.get('kick.com', '/api/v2/channels/' + name, true).then(function (text) {
        var value = JSON.parse(text);
        if (value.slug !== name) throw Error('wrong channel');
        var result = card(value, true);
        if (!stopped && result) items.push(result);
      }).catch(function () { failed++; }).then(function () {
        pending--; completed++; worker();
      });
    }
    worker(); worker();
  });
}

module.exports = { options: options, pathFor: pathFor, register: register };
