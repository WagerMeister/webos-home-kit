/* Lightweight local calendar, 3-day MET forecast and time-of-day scenery for Hearth. ES5. */
(function (root, doc) {
  'use strict';
  var model = root.__HearthForecastModel;
  if (!model) return;
  var CONFIG = 'customlauncher-config-v1';
  var FORECAST = 'hearth-dashboard-forecast-v1';
  var SENTINEL = '/media/developer/wallpapers/seasonal-scenes';
  var panel = null, forecastNode = null, calendarNode = null, home = null;
  var minuteTimer = null, eventTimer = null, fetchTimer = null;
  var homeObserver = null, started = false, fetching = false, lastAttempt = 0;
  var calendarSignature = '', weatherSignature = '', wallpaper = null, wallpaperPhase = '';
  var image = null, imageSeq = 0;
  var cachedSource = null;
  var MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  function read(key) { try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (error) { return null; } }
  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function number(value, places) { return value.toFixed(places).replace('.', ','); }
  function glyph(symbol) {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox','0 0 32 32'); svg.setAttribute('class','dashboard-card-icon');
    svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.8'); svg.setAttribute('stroke-linecap','round');
    function path(d) { var p = doc.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',d); svg.appendChild(p); }
    if (/clearsky|fair/.test(symbol)) {
      var circle = doc.createElementNS('http://www.w3.org/2000/svg','circle'); circle.setAttribute('cx','16');circle.setAttribute('cy','16');circle.setAttribute('r','6');svg.appendChild(circle);
      path('M16 3v3M16 26v3M3 16h3M26 16h3M7 7l2 2M23 23l2 2M7 25l2-2M23 9l2-2');
    } else {
      path('M8 22h16a5 5 0 0 0 0-10 8 8 0 0 0-15-1 5.5 5.5 0 0 0-1 11');
      if (/snow|sleet/.test(symbol)) path('M10 26v3M17 26v3M24 26v3');
      else if (/rain/.test(symbol)) path('M11 25l-2 4M18 25l-2 4M25 25l-2 4');
      else if (/thunder/.test(symbol)) path('M17 19l-4 7h5l-3 5');
      else if (/fog/.test(symbol)) path('M5 26h22M9 30h14');
    }
    return svg;
  }
  function renderCalendar(now) {
    var signature = model.dayKey(now);
    if (signature === calendarSignature) return;
    calendarSignature = signature;
    var data = model.calendar(now);
    clear(calendarNode);
    calendarNode.appendChild(el('h2','dashboard-calendar-title',MONTHS[data.month] + ' ' + data.year));
    var table = el('table'); table.setAttribute('aria-label','Календарь; сегодня ' + data.today);
    var head = el('thead'), row = el('tr');
    ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].forEach(function (day) { row.appendChild(el('th','',day)); });
    head.appendChild(row);table.appendChild(head);
    var body = el('tbody');
    data.cells.forEach(function (day, i) {
      if (i % 7 === 0) { row = el('tr'); body.appendChild(row); }
      var cell = el('td', day === data.today ? 'today' : i % 7 >= 5 ? 'weekend' : '');
      cell.appendChild(el('span','',day ? String(day) : ''));
      if (day === data.today) cell.setAttribute('aria-current','date');
      row.appendChild(cell);
    });
    table.appendChild(body);calendarNode.appendChild(table);
  }
  function renderForecast(config, now) {
    var wx = config.weather || {};
    if (!wx.on || !wx.city) { forecastNode.style.display = 'none'; return; }
    forecastNode.style.display = '';
    var cache = cachedSource;
    var valid = model.sourceUsable(cache, wx.city, now.getTime());
    var data = null;
    if (valid) {
      try { data = model.forecast(cache.source, wx.city, Math.floor(now.getTime() / 60000) * 60000); }
      catch (error) { valid = false; }
    }
    var signature = JSON.stringify([valid ? data : null, wx.city, wx.unit, wx.showCity]);
    if (signature !== weatherSignature) {
      weatherSignature = signature; clear(forecastNode);
      forecastNode.appendChild(el('h2','dashboard-kicker',(wx.showCity ? wx.city.name + ' · ' : '') + 'Прогноз на 3 дня'));
      var cards = el('div','dashboard-cards');
      for (var i = 0; i < 3; i += 1) {
        var item = valid ? data.days[i] : null;
        var card = el('section','dashboard-card');
        card.appendChild(el('div','dashboard-card-day',['Сегодня','Завтра','Послезавтра'][i]));
        if (item) {
          var main = el('div','dashboard-card-main');main.appendChild(glyph(item.symbol));
          var value = wx.unit === 'f' ? item.tempC * 9 / 5 + 32 : item.tempC;
          main.appendChild(el('span','dashboard-card-temp',Math.round(value) + '°'));
          main.appendChild(el('span','dashboard-card-time','к ' + (item.hour < 10 ? '0' : '') + item.hour + ':00'));
          card.appendChild(main);
          card.appendChild(el('div','dashboard-card-info','Ветер ' + (item.windMS === null ? '—' : number(item.windMS,1) + ' м/с')));
          card.appendChild(el('div','dashboard-card-info','Осадки ' + (item.precipitationMM === null ? '—' : '≈' + number(item.precipitationMM,1) + ' мм')));
        } else {
          card.appendChild(el('div','dashboard-card-main','—'));
          card.appendChild(el('div','dashboard-card-info',valid ? 'Нет данных' : 'Прогноз обновляется'));
        }
        cards.appendChild(card);
      }
      forecastNode.appendChild(cards);
      forecastNode.appendChild(el('div','dashboard-attribution','MET Norway · CC BY 4.0 · сегодня: осадки до конца дня'));
    }
    if (!valid && !fetching && now.getTime() - lastAttempt > 60000 && root.__hearthMetWeather) {
      fetching = true; lastAttempt = now.getTime();
      root.__hearthMetWeather.fetch(wx.city).then(function () { fetching = false; refresh(); }, function () { fetching = false; });
    }
  }
  function background(config, now) {
    var current = doc.querySelector('#root > .wallpaper');
    var enabled = config.background === 'theme' && config.wallpaper && config.wallpaper.mode === 'gradient' && config.wallpaper.path === SENTINEL;
    if (!current || !enabled || doc.hidden) {
      imageSeq += 1; image = null;
      if (wallpaper) { wallpaper.style.backgroundImage = ''; wallpaper.style.backgroundSize = ''; }
      wallpaper = null; wallpaperPhase = ''; return;
    }
    var scenery = root.__hearthScenery ? root.__hearthScenery.state(now, config.weather && config.weather.city, config.scenery) : null;
    var next = scenery ? scenery.season + '/' + scenery.phase : model.phase(now.getHours());
    var relative = scenery ? scenery.asset : next + '.jpg';
    if (wallpaper === current && wallpaperPhase === next) return;
    var seq = ++imageSeq;
    var picture = new root.Image(); image = picture;
    var anchor = doc.createElement('a');anchor.href = './dashboard/' + relative;
    picture.onload = function () {
      if (seq !== imageSeq || doc.hidden || !picture.naturalWidth) return;
      current.style.backgroundImage = 'linear-gradient(to bottom,rgba(3,12,30,.20),rgba(3,12,30,0) 60%,rgba(3,12,30,.40)),url("' + anchor.href + '")';
      current.style.backgroundSize = '100% 100%,cover';
      current.style.backgroundPosition = 'center,center';
      if (scenery) { current.setAttribute('data-scenery-season', scenery.season); current.setAttribute('data-scenery-phase', scenery.phase); }
      wallpaper = current; wallpaperPhase = next; image = null;
    };
    picture.onerror = function () { if (seq === imageSeq) image = null; };
    picture.src = anchor.href;
  }
  function refresh() {
    if (!started) return;
    var showing = !!(home && !home.classList.contains('screen--away') && !doc.hidden);
    panel.style.display = showing ? 'block' : 'none';
    var config = read(CONFIG);
    if (!config) return;
    var now = new Date();
    background(config, now);
    if (!showing) return;
    renderCalendar(now);renderForecast(config, now);
  }
  function visible() {
    root.clearTimeout(minuteTimer);root.clearTimeout(eventTimer);root.clearTimeout(fetchTimer);
    minuteTimer = eventTimer = fetchTimer = null;
    cachedSource = read(FORECAST);
    refresh();
    if (!doc.hidden) minuteTimer = root.setTimeout(visible, 60000 - Date.now() % 60000 + 40);
  }
  function onKey() {
    if (doc.hidden) return;
    root.clearTimeout(eventTimer);eventTimer = root.setTimeout(refresh, 250);
  }
  function attach() {
    if (started) return true;
    home = doc.querySelector('#root > .screen');
    if (!home) return false;
    started = true;
    panel = el('div','dashboard-dashboard');panel.id = 'hearth-dashboard-dashboard';
    forecastNode = el('section','dashboard-forecast');calendarNode = el('section','dashboard-calendar');
    panel.appendChild(forecastNode);panel.appendChild(calendarNode);doc.body.appendChild(panel);
    homeObserver = new root.MutationObserver(refresh);homeObserver.observe(home,{attributes:true,attributeFilter:['class']});
    var rootObserver = new root.MutationObserver(refresh);rootObserver.observe(doc.getElementById('root'),{childList:true});
    doc.addEventListener('visibilitychange', visible);doc.addEventListener('webOSRelaunch',visible);
    doc.addEventListener('keyup',onKey);root.addEventListener('hearth:forecast',function () { cachedSource = read(FORECAST);refresh(); });
    visible();return true;
  }
  function begin() {
    if (attach()) return;
    var target = doc.getElementById('root');
    if (!target) return;
    var observer = new root.MutationObserver(function () { if (attach()) observer.disconnect(); });
    observer.observe(target,{childList:true});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded',begin);else begin();
}(window, document));
