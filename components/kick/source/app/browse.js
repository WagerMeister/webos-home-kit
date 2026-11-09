/* Six-card, cancellable live directory. No media starts until a viewer selects it. */
function KickBrowse(options) {
  'use strict';
  var ru = options.language === 'ru';
  var words = ru ? {
    popular: 'Сейчас в эфире', featured: 'Подборка Kick', favorites: 'Мои онлайн', library: 'Моя библиотека',
    language: 'Язык: ', russian: 'Русский', all: 'Все', category: 'Категория: ', refresh: 'Обновить',
    loading: 'Загружаю эфиры…', empty: 'Сейчас здесь нет онлайн-каналов.', noFavorites: 'Добавь каналы в избранное — здесь появятся те, кто в эфире.',
    failed: 'Не удалось загрузить эфиры. Проверь сеть и нажми «Обновить».', incomplete: 'Часть каналов проверить не удалось.',
    previous: '← Назад', next: 'Далее →', viewers: ' зрителей', countHidden: 'Счётчик скрыт', add: 'В избранное: ', remove: 'Из избранного: ',
    featuredNote: 'Общая подборка Kick, не персональная лента аккаунта.', popularNote: 'Онлайн сейчас · по числу зрителей', favoritesNote: 'Избранные каналы, которые сейчас в эфире'
  } : {
    popular: 'Live now', featured: 'Kick picks', favorites: 'Favorites live', library: 'My library',
    language: 'Language: ', russian: 'Russian', all: 'All', category: 'Category: ', refresh: 'Refresh',
    loading: 'Loading live streams…', empty: 'No live channels match these filters.', noFavorites: 'Add favorite channels to see which are live here.',
    failed: 'Could not load streams. Check your connection and refresh.', incomplete: 'Some channels could not be checked.',
    previous: '← Previous', next: 'Next →', viewers: ' viewers', countHidden: 'Viewer count hidden', add: 'Favorite: ', remove: 'Unfavorite: ',
    featuredNote: 'General Kick picks, not account-personalized recommendations.', popularNote: 'Live now · most viewers first', favoritesNote: 'Your favorite channels that are live now'
  };
  function el(id) { return document.getElementById(id); }
  var mode = 'popular', language = 'ru', category = 0, categories = [], cursor = '', stack = [], nextCursor = '';
  var active = false, bridge = null, timer = null, epoch = 0, items = [], favoritePage = 0, cards = [], controls = [];
  var snapshot = null, loadedAt = 0, focusedIndex = 0, busy = false;
  var tabs = ['popular', 'featured', 'favorites', 'library'].map(function (name) {
    var button = el('browse-' + name); button.textContent = words[name];
    button.addEventListener('click', function () { choose(name); }); return button;
  });
  try { var saved = localStorage.getItem('kick-browse-mode'); if (['popular', 'featured', 'favorites', 'library'].indexOf(saved) >= 0) mode = saved; } catch (e) { /* Session defaults. */ }
  el('browse-tabs').hidden = false;
  el('browse-refresh').textContent = words.refresh;
  el('browse-previous').textContent = words.previous; el('browse-next').textContent = words.next;
  function cancel() {
    epoch++; clearTimeout(timer); timer = null; busy = false;
    if (bridge) { bridge.onservicecallback = function () {}; try { bridge.cancel(); } catch (e) { /* Closed bridge. */ } }
    bridge = null;
  }
  function release() { cards = []; controls = []; var list = el('browse-cards'); while (list.firstChild) list.removeChild(list.firstChild); }
  function updateLabels() {
    tabs.forEach(function (button, i) { button.setAttribute('aria-pressed', String(['popular', 'featured', 'favorites', 'library'][i] === mode)); });
    el('browse-language').textContent = words.language + (language === 'ru' ? words.russian : words.all);
    var selected = categories.filter(function (item) { return item.id === category; })[0];
    el('browse-category').textContent = words.category + (selected ? selected.name : words.all);
    el('browse-language').hidden = el('browse-category').hidden = mode === 'favorites';
    el('browse-note').textContent = mode === 'featured' ? words.featuredNote : mode === 'favorites' ? words.favoritesNote : words.popularNote;
  }
  function display() {
    var library = mode === 'library';
    el('home').setAttribute('data-browse-mode',mode);
    document.querySelector('#home-content > .content').hidden = !library;
    document.querySelector('.home-shelves').hidden = !library;
    el('browse-panel').hidden = library;
    updateLabels();
  }
  function render() {
    release(); if (!active || mode === 'library' || document.hidden) return;
    var list = el('browse-cards'), shown = mode === 'favorites' ? items.slice(favoritePage * 6, favoritePage * 6 + 6) : items;
    var favorites = options.favorites();
    if(mode==='favorites'){items=items.filter(function(item){return favorites.indexOf(item.channel)>=0;});favoritePage=Math.min(favoritePage,Math.max(0,Math.ceil(items.length/6)-1));shown=items.slice(favoritePage*6,favoritePage*6+6);}
    shown.forEach(function (item, index) {
      var row = document.createElement('div'); row.className = 'browse-card';
      var play = document.createElement('button'); play.type = 'button'; play.className = 'browse-play';
      var preview = document.createElement('span'); preview.className = 'browse-preview';
      if (item.thumbnail && /^https:\/\/(?:files|images)\.kick\.com\//.test(item.thumbnail)) {
        var image = document.createElement('img'); image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', function () { image.hidden = true; }); image.src = item.thumbnail; preview.appendChild(image);
      }
      var title = document.createElement('strong'); title.textContent = item.title;
      var detail = document.createElement('span'); detail.className = 'browse-detail';
      detail.textContent = item.channel + ' · ' + (item.viewers === null ? words.countHidden : String(item.viewers) + words.viewers);
      var categoryLabel = document.createElement('small'); categoryLabel.textContent = item.category ? item.category.name : '';
      play.appendChild(preview); play.appendChild(title); play.appendChild(detail); play.appendChild(categoryLabel);
      play.addEventListener('click', function () { focusedIndex = index; options.open(item.channel); });
      var heart = document.createElement('button'); heart.type = 'button'; heart.className = 'browse-heart';
      var saved = favorites.indexOf(item.channel) >= 0;
      heart.textContent = saved ? '♥' : '♡'; heart.setAttribute('aria-pressed', String(saved));
      heart.setAttribute('aria-label', (saved ? words.remove : words.add) + item.channel);
      heart.addEventListener('click', function () {
        options.favorite(item.channel); snapshot = null; if(mode==='favorites'){items=items.filter(function(entry){return options.favorites().indexOf(entry.channel)>=0;});favoritePage=Math.min(favoritePage,Math.max(0,Math.ceil(items.length/6)-1));} render(); (controls[index * 2 + 1] || tabs[0]).focus();
      });
      row.appendChild(play); row.appendChild(heart); list.appendChild(row); cards.push(play); controls.push(play, heart);
    });
    el('browse-status').textContent = busy ? words.loading : !shown.length ? mode === 'favorites' && !options.favorites().length ? words.noFavorites : words.empty : '';
    el('browse-previous').disabled = mode === 'favorites' ? favoritePage === 0 : stack.length === 0;
    el('browse-next').disabled = mode === 'favorites' ? (favoritePage + 1) * 6 >= items.length : !nextCursor;
    el('browse-page').textContent = String(mode === 'favorites' ? favoritePage + 1 : stack.length + 1);
  }
  function load(force) {
    if (!active || document.hidden || mode === 'library') return;
    if (!force && snapshot && Date.now() - loadedAt < 45000) { render(); return; }
    cancel(); busy = true; render(); el('browse-status').textContent = words.loading;
    var token = epoch, payload = mode === 'favorites' ? { channels: options.favorites().slice(0, 50) } :
      { sort: mode, language: language, category: category, cursor: cursor };
    function finish(data) {
      if (token !== epoch || !active || document.hidden) return;
      var previous = bridge; bridge = null; clearTimeout(timer); timer = null; busy = false;
      if (previous) { previous.onservicecallback = function () {}; try { previous.cancel(); } catch (e) { /* Done. */ } }
      var oldIndex=controls.indexOf(document.activeElement),moveFocus=document.activeElement===el('browse-next')||document.activeElement===el('browse-previous')||oldIndex>=0;
      if (!data || data.returnValue !== true || !Array.isArray(data.items)) {
        release(); el('browse-status').textContent = words.failed; nextCursor = ''; if(moveFocus)el('browse-refresh').focus(); return;
      }
      items = data.items.slice(0, mode === 'favorites' ? 50 : 6); nextCursor = data.nextCursor || '';
      items.forEach(function (item) { if (item.category && !categories.some(function (c) { return c.id === item.category.id; }) && categories.length < 60) categories.push(item.category); });
      snapshot = payload; loadedAt = Date.now(); updateLabels(); render();
      if (data.incomplete) el('browse-status').textContent = words.incomplete;
      if(moveFocus)(controls[oldIndex>=0?Math.min(oldIndex,controls.length-1):0]||el('browse-refresh')).focus();
    }
    try {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (response) {
        var data; try { if (response.length > 1048576) throw Error('size'); data = JSON.parse(response); } catch (e) { data = null; }
        finish(data);
      };
      timer = setTimeout(function () { finish(null); }, mode === 'favorites' ? 28000 : 15000);
      bridge.call('luna://com.jakubjirak.service/' + (mode === 'favorites' ? 'liveFavorites' : 'directory'), JSON.stringify(payload));
    } catch (e) { finish(null); }
  }
  function choose(name) {
    cancel(); mode = name; cursor = ''; stack = []; nextCursor = ''; items = []; favoritePage = 0; snapshot = null; focusedIndex = 0;
    try { if (localStorage.getItem('kick-browse-mode') !== mode) localStorage.setItem('kick-browse-mode', mode); } catch (e) { /* Session only. */ }
    display(); options.mode(mode); if (name !== 'library') load(true);
  }
  el('browse-refresh').addEventListener('click', function () { load(true); });
  el('browse-language').addEventListener('click', function () { language = language === 'ru' ? 'all' : 'ru'; cursor = ''; stack = []; snapshot = null; load(true); updateLabels(); });
  el('browse-category').addEventListener('click', function () {
    var index = categories.map(function (item) { return item.id; }).indexOf(category);
    category = index + 1 < categories.length ? categories[index + 1].id : 0;
    cursor = ''; stack = []; snapshot = null; load(true); updateLabels();
  });
  [-1, 1].forEach(function (delta) { el(delta < 0 ? 'browse-previous' : 'browse-next').addEventListener('click', function () {
    if (mode === 'favorites') { favoritePage += delta; render(); (cards[0] || tabs[2]).focus(); }
    else { if (delta > 0) { stack.push(cursor); if (stack.length > 40) stack.shift(); cursor = nextCursor; } else cursor = stack.pop() || ''; load(true); }
  }); });
  function focus() { (mode === 'library' ? options.libraryFocus() : cards[focusedIndex] || tabs[['popular', 'featured', 'favorites', 'library'].indexOf(mode)]).focus(); }
  function key(event) {
    if (!active || document.hidden) return false;
    var code = event.keyCode, target = event.target, tab = tabs.indexOf(target);
    if (mode === 'library' && tab < 0) return false;
    if (code < 37 || code > 40) return false;
    event.preventDefault();
    if (tab >= 0) {
      if (code === 37 || code === 39) tabs[Math.max(0, Math.min(3, tab + (code === 37 ? -1 : 1)))].focus();
      else if (code === 40) (mode === 'library' ? options.libraryFocus() : cards[0] || el('browse-refresh')).focus();
      return true;
    }
    var cardIndex = controls.indexOf(target);
    if (cardIndex >= 0) {
      var column = cardIndex % 2, index = Math.floor(cardIndex / 2), next;
      if (code === 38 || code === 40) {
        next = index + (code === 38 ? -3 : 3);
        if (next < 0) el('browse-refresh').focus();
        else if (next >= cards.length) (el('browse-next').disabled ? el('browse-refresh') : el('browse-next')).focus();
        else controls[next * 2 + column].focus();
      } else { next = Math.max(0, Math.min(controls.length - 1, cardIndex + (code === 37 ? -1 : 1))); controls[next].focus(); }
      return true;
    }
    var group = [el('browse-language'), el('browse-category'), el('browse-refresh'), el('browse-previous'), el('browse-next'), el('about-button'), el('accessibility-button')].filter(function (button) { return !button.hidden && !button.disabled; });
    var index = group.indexOf(target);
    if (code === 38) tabs[['popular', 'featured', 'favorites', 'library'].indexOf(mode)].focus();
    else if (code === 40 && cards.length) cards[0].focus();
    else group[Math.max(0, Math.min(group.length - 1, index + (code === 37 ? -1 : 1)))].focus();
    return true;
  }
  return { key: key, focus: focus, tabs: tabs, mode: function () { return mode; },
    setVisible: function (value) { active = value; if (!value) { cancel(); release(); } else { display(); if (mode !== 'library') load(false); } },
    refresh: function () { if (active && mode !== 'library') load(true); } };
}
