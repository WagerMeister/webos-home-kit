function kickChannel(value) {
  if (typeof value !== 'string') return '';
  var input = value.trim().toLowerCase();
  var url = input.match(/^(?:https:\/\/)?(?:www\.)?kick\.com\/([a-z0-9_-]{1,25})\/?$/);
  return url ? url[1] : (/^[a-z0-9_-]{1,25}$/.test(input) ? input : '');
}
if (typeof module !== 'undefined') module.exports = kickChannel;

if (typeof document !== 'undefined') (function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  var localeScope = {};
  if (typeof webOSSystem !== 'undefined') localeScope.webOSSystem = webOSSystem;
  if (typeof PalmSystem !== 'undefined') localeScope.PalmSystem = PalmSystem;
  if (typeof navigator !== 'undefined') localeScope.navigator = navigator;
  var t = KickI18n.translator(KickI18n.detect(localeScope));
  // Static labels declare their key in markup: data-i18n for text, data-i18n-attr="attr:key;attr:key" for attributes.
  var labelled = document.querySelectorAll('[data-i18n],[data-i18n-attr]');
  for (var l = 0; l < labelled.length; l++) (function (node) {
    var textKey = node.getAttribute('data-i18n'), attributes = node.getAttribute('data-i18n-attr');
    if (textKey) node.textContent = t(textKey);
    if (attributes) attributes.split(';').forEach(function (pair) {
      var parts = pair.split(':');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) node.setAttribute(parts[0].trim(), t(parts[1].trim()));
    });
  }(labelled[l]));
  try { document.title = t('title'); if (document.documentElement) document.documentElement.lang = t.language; } catch (e) { /* Optional metadata. */ }
  var input = el('channel');
  var browse = null;
  var speedPreference=1, speedButtons=[], openingSpeed=false, collectingSpeed=false, browserAutoStarted=false, speedEpoch=0;
  var runtime=typeof KickRuntime!=='undefined'?KickRuntime:null;
  var speedWords=t.language==='ru'?{button:'Скорость: ',heading:'Скорость записи',cancel:'Отмена',opening:'Открываю ускоренное воспроизведение…',failed:'Не удалось открыть ускоренный плеер. Продолжаю на 1×.'}:{button:'Speed: ',heading:'Replay speed',cancel:'Cancel',opening:'Opening accelerated playback…',failed:'Could not open accelerated playback. Continuing at 1×.'};
  var playback = { paused: true, phase: 'idle', position: 0, duration: 0, ready: false, seeking: false };
  var preparing = false, qualityPreference = 'auto', qualityButtons = [], acceleratedQuality = false;
  var hidingControls = false, pointerX = null, pointerY = null;
  var accessibility = { size: 'normal', contrast: false }, accessibilityOpen = false;
  var page = 0, catalogQuery = '', catalogFilter = 'all', catalogOrder = 'newest', toolsSnapshot = null;
  var savedPage = 0, savedSearchButtons = [];
  var recents = [];
  var recentPage = 0, recentStatus = Object.create(null), recentRequest = null, recentTimer, recentGeneration = 0;
  var favorites = [], favoritePage = 0, favoriteButtons = [], favoriteControls = [], favoriteMove = null;
  var continuePage = 0, continueControls = [], continueRequests = [], continueGeneration = 0;
  var resumeItem = null, resumeFocus = null;
  var watched = [], historyDirty = false, historyWrittenAt = 0;
  var recentButtons = [], recentControls = [];
  var videoButtons = [];
  var updateRetryAt = 0;
  var releaseCache = null, installedVersion = el('app-version').textContent.replace(/^v/, '');
  var current = null;
  var catalog = null;
  var screen = 'home';
  var request = null;
  var requestTimer;
  var controlsTimer;
  var generation = 0;
  var scrubbing = false, jumpOpen = false;
  var timelineState = '';
  var homePageSize = 6, homeLayoutTimer;
  function cancelHomeLayout() { clearTimeout(homeLayoutTimer); homeLayoutTimer = null; }
  function fitHome() {
    cancelHomeLayout();
    if (screen !== 'home' || document.hidden || typeof window.getComputedStyle !== 'function') return;
    homeLayoutTimer = setTimeout(function () {
      homeLayoutTimer = null;
      if (screen !== 'home' || document.hidden) return;
      var size = 6;
      [['recent', 'recent-channels'], ['favorites-section', 'favorite-list'], ['continue-section', 'continue-list']].forEach(function (ids) {
        var panel = el(ids[0]), list = el(ids[1]), row = list.firstChild;
        if (panel.hidden || !row) return;
        var box = list.getBoundingClientRect(), style = window.getComputedStyle(row);
        var rowHeight = row.getBoundingClientRect().height + parseFloat(style.marginBottom || 0);
        // Reserve paging even on the first page, where it may still be hidden.
        var available = panel.getBoundingClientRect().bottom - box.top - 72;
        if (rowHeight > 0) size = Math.min(size, Math.max(1, Math.floor((available + parseFloat(style.marginBottom || 0)) / rowHeight)));
      });
      if (size === homePageSize) return;
      var active = document.activeElement, groups = [recentControls, favoriteControls, continueControls], pages = [recentPage, favoritePage, continuePage];
      var strides = [3, 3, 2], focused = -1, column = 0, rowIndex = 0;
      var pagerIds = [['recent-previous', 'recent-next'], ['favorite-previous', 'favorite-next'], ['continue-previous', 'continue-next']], pager = -1;
      pagerIds.forEach(function (ids, i) { if (ids.indexOf(active.id) >= 0) pager = i; });
      groups.forEach(function (group, i) {
        var index = group.indexOf(active);
        if (index >= 0) { focused = i; column = index % strides[i]; rowIndex = pages[i] * homePageSize + Math.floor(index / strides[i]); }
        pages[i] = Math.floor(pages[i] * homePageSize / size);
      });
      if (focused >= 0) pages[focused] = Math.floor(rowIndex / size);
      recentPage = pages[0]; favoritePage = pages[1]; continuePage = pages[2]; homePageSize = size;
      cancelRecentStatus(); renderRecents(); renderFavorites(); renderContinue(); refreshRecentStatus();
      if (focused >= 0) {
        var control = [recentControls, favoriteControls, continueControls][focused][(rowIndex % size) * strides[focused] + column];
        (control || input).focus();
      } else if (pager >= 0 && (active.disabled || !active.getClientRects().length)) {
        ([recentControls, favoriteControls, continueControls][pager][0] || input).focus();
      }
    }, 0);
  }
  var catalogPageSize = 6, catalogLayoutTimer;
  function cancelCatalogLayout() { clearTimeout(catalogLayoutTimer); catalogLayoutTimer = null; }
  function fitCatalog() {
    cancelCatalogLayout();
    if (screen !== 'catalog' || document.hidden || typeof window.getComputedStyle !== 'function') return;
    catalogLayoutTimer = setTimeout(function () {
      catalogLayoutTimer = null;
      if (screen !== 'catalog' || document.hidden || !videoButtons.length) return;
      var list = el('videos'), card = videoButtons[0], preview = card.querySelector('.video-preview');
      var columns = window.innerWidth <= 560 ? 1 : accessibility.size === 'large' || window.innerWidth <= 800 ? 2 : 3;
      var previewMinimum = parseFloat(window.getComputedStyle(preview).minHeight);
      var cardStyle = window.getComputedStyle(card), textHeight = parseFloat(cardStyle.borderTopWidth) + parseFloat(cardStyle.borderBottomWidth);
      for (var c = 0; c < card.children.length; c++) if (card.children[c] !== preview) {
        var child = card.children[c], childStyle = window.getComputedStyle(child);
        textHeight += child.getBoundingClientRect().height + parseFloat(childStyle.marginTop || 0) + parseFloat(childStyle.marginBottom || 0);
      }
      var rows = Math.max(1, Math.min(2, Math.floor((list.clientHeight + 22) / (textHeight + previewMinimum + 22))));
      list.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))'; list.setAttribute('data-rows', String(rows));
      var size = Math.min(6, rows * columns);
      if (size === catalogPageSize) return;
      var active = document.activeElement, index = videoButtons.indexOf(active), absolute = page * catalogPageSize + Math.max(0, index);
      page = Math.floor(absolute / size); catalogPageSize = size; renderVideos();
      if (index >= 0) (videoButtons[absolute % size] || videoButtons[0] || el('catalog-back')).focus();
      else if ((active === el('previous-page') || active === el('next-page')) && (active.disabled || !active.getClientRects().length))
        (videoButtons[0] || el('catalog-back')).focus();
    }, 0);
  }
  var player = KickPlayer(el('video-host'), { status: mediaStatus, change: function (next) {
    var transition = playback.phase !== next.phase || playback.paused !== next.paused, durationChanged = playback.duration !== next.duration;
    playback = next;
    if(runtime&&runtime.browser)runtime.update(next,speedPreference);
    if (jumpOpen && durationChanged) jumpPreview();
    el('quality-button').disabled = preparing || !!next.network || !current || !current.prepared;
    if (next.network) closeQuality();
    var label = next.phase === 'error' ? t('retry') : next.paused ? t('resume') : t('pause');
    if (el('toggle').textContent !== label) el('toggle').textContent = label;
    updateTimeline();
    if (next.paused) saveWatched();
    if (transition && screen === 'watch' && next.phase !== 'idle') showControls();
  }, progress: rememberVideo, refresh: refreshSource, cancelRefresh: cancelRequest, interact: function () { if(el('playback-controls').hidden){showControls();el('toggle').focus();}else hideControls(); } });

  function searchText(value) {
    var text = titleSlice(String(value || ''));
    if (typeof text.normalize === 'function') text = text.normalize('NFKC');
    return text.toLowerCase().trim();
  }
  function closeSearch(save, focus) {
    var wasSaved = !el('saved-search').hidden, wasTools = !!toolsSnapshot;
    el('saved-search').hidden = el('replay-tools').hidden = true; savedSearchButtons = [];
    if (toolsSnapshot) {
      if (!save && toolsSnapshot.catalog === catalog) {
        catalogQuery = toolsSnapshot.query; catalogFilter = toolsSnapshot.filter; catalogOrder = toolsSnapshot.order; page = Math.floor(toolsSnapshot.offset / catalogPageSize);
        renderVideos();
      }
      toolsSnapshot = null;
    }
    if (focus && wasSaved) el('find-saved').focus();
    else if (focus && wasTools) (save && videoButtons[0] || el('catalog-search')).focus();
  }
  function renderSavedSearch() {
    var query = searchText(el('saved-query').value), names = favorites.concat(recents).filter(function (name, index, all) {
      return all.indexOf(name) === index && (!query || searchText(name).indexOf(query) >= 0);
    });
    var pages = Math.max(1, Math.ceil(names.length / 6)); savedPage = Math.max(0, Math.min(savedPage, pages - 1));
    var list = el('saved-results'); while (list.firstChild) list.removeChild(list.firstChild); savedSearchButtons = [];
    names.slice(savedPage * 6, savedPage * 6 + 6).forEach(function (name) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = name;
      button.addEventListener('click', function () { closeSearch(true, false); startChannel(name, true); });
      list.appendChild(button); savedSearchButtons.push(button);
    });
    el('saved-count').textContent = t('results_count', { count: names.length });
    el('saved-number').textContent = (savedPage + 1) + ' / ' + pages;
    el('saved-previous').disabled = savedPage === 0; el('saved-next').disabled = savedPage === pages - 1;
  }
  function filteredVideos() {
    var query = searchText(catalogQuery);
    return (catalog ? catalog.videos : []).map(function (item, index) { return { item: item, index: index }; }).filter(function (row) {
      var entry = watchedVideo(row.item), state = !entry ? 'unwatched' : entry.finished ? 'finished' : 'progress';
      return (!query || searchText(row.item.title || t('replay')).indexOf(query) >= 0) && (catalogFilter === 'all' || catalogFilter === state);
    }).sort(function (a, b) {
      var ad = /^\d{4}-\d{2}-\d{2}$/.test(a.item.date || '') ? a.item.date : '', bd = /^\d{4}-\d{2}-\d{2}$/.test(b.item.date || '') ? b.item.date : '';
      if (!ad !== !bd) return ad ? -1 : 1;
      var dates = ad < bd ? -1 : ad > bd ? 1 : 0;
      var ai = String(a.item.id || ''), bi = String(b.item.id || '');
      return dates * (catalogOrder === 'oldest' ? 1 : -1) || (ai < bi ? -1 : ai > bi ? 1 : 0) || a.index - b.index;
    }).map(function (row) { return row.item; });
  }
  function updateSearch() {
    catalogQuery = String(el('replay-query').value || '').slice(0, 200); page = 0;
    el('replay-filter').textContent = t('filter_' + catalogFilter); el('replay-sort').textContent = t('order_' + catalogOrder); renderVideos();
  }
  function closeJump(focus) {
    var wasOpen = jumpOpen; jumpOpen = false; el('jump-dialog').hidden = true;
    if (focus && wasOpen && screen === 'watch') { showControls(); el('jump-time').focus(); }
  }
  function readJump() {
    var values = ['jump-hours', 'jump-minutes', 'jump-seconds'].map(function (id) { return String(el(id).value || '').trim(); });
    if (!/^\d{1,3}$/.test(values[0]) || !/^\d{1,2}$/.test(values[1]) || !/^\d{1,2}$/.test(values[2]) || +values[0] > 720 || +values[1] > 59 || +values[2] > 59) return null;
    return +values[0] * 3600 + +values[1] * 60 + +values[2];
  }
  function jumpPreview() {
    var target = readJump();
    el('jump-error').textContent = target === null ? t('jump_invalid') : '';
    el('jump-preview').textContent = target === null ? '' : t('jump_target', { time: formatTime(Math.min(target, Math.max(0, playback.duration - 0.1))) });
    el('jump-confirm').disabled = target === null;
    return target;
  }
  function jumpFields(target) {
    target = Math.floor(Math.max(0, Math.min(Math.max(0, playback.duration - 0.1), target)));
    el('jump-hours').value = String(Math.floor(target / 3600));
    el('jump-minutes').value = ('0' + Math.floor(target % 3600 / 60)).slice(-2);
    el('jump-seconds').value = ('0' + target % 60).slice(-2); jumpPreview();
  }
  function openJump(delta) {
    if (!current || current.isLive || preparing || playback.phase === 'error' || !playback.duration) return;
    jumpFields(playback.position + (delta || 0)); jumpOpen = true; el('jump-dialog').hidden = false; showControls(); el('jump-hours').focus();
  }
  function jumpStep(delta) { var target = readJump(); if (target !== null) jumpFields(target + delta); else jumpPreview(); }
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
  function validRelease(release) {
    return release && versionParts(release.version) && typeof release.url === 'string' &&
      (release.url === 'https://github.com/JirakJ/kick-web-os-app/releases/tag/v' + release.version || release.url === 'https://github.com/JirakJ/kick-web-os-app/releases/tag/' + release.version) &&
      typeof release.notes === 'string' && release.notes.length <= 2000 && typeof release.checkedAt === 'number' && isFinite(release.checkedAt) && release.checkedAt > 0 && release.checkedAt <= Date.now() + 60000;
  }
  function showRelease(cached) {
    el('installed-version').textContent = t('installed_version', { version: installedVersion });
    el('latest-version').textContent = releaseCache ? t('latest_version', { version: releaseCache.version }) : t('update_not_checked');
    el('release-notes').textContent = releaseCache ? releaseCache.notes : '';
    el('release-url').textContent = releaseCache ? releaseCache.url : '';
    el('update-cache-note').textContent = cached && releaseCache ? t('update_cached') : '';
    if (releaseCache) {
      var order = compareVersions(releaseCache.version, installedVersion);
      el('update-status').textContent = t(order > 0 ? 'update_available' : order < 0 ? 'update_development' : 'update_current');
    } else el('update-status').textContent = t('update_not_checked');
  }
  function openAbout() { setScreen('about'); el('check-updates').disabled = false; showRelease(true); el('check-updates').focus(); }
  function closeAbout() { goHome(); el('about-button').focus(); }
  function checkUpdates() {
    if (screen !== 'about' || document.hidden) return;
    if (releaseCache && Date.now() >= releaseCache.checkedAt && Date.now() - releaseCache.checkedAt < 21600000) { showRelease(true); return; }
    if (navigator.onLine === false || Date.now() < updateRetryAt) { el('update-status').textContent = t('update_unavailable'); return; }
    el('check-updates').disabled = true; el('update-status').textContent = t('update_checking');
    callService('updates', {}, function (data) {
      el('check-updates').disabled = false;
      if (screen !== 'about' || document.hidden) return;
      if (!data.returnValue || !validRelease(data.release)) {
        updateRetryAt = Math.max(Date.now() + 60000, typeof data.retryAt === 'number' && isFinite(data.retryAt) && data.retryAt <= 4102444800000 ? data.retryAt : 0);
        try { localStorage.setItem('kick-update-retry-at', String(updateRetryAt)); } catch (e) { /* Keep session backoff. */ }
        el('update-status').textContent = t('update_unavailable'); return;
      }
      updateRetryAt = 0; try { localStorage.setItem('kick-update-retry-at', '0'); } catch (e) { /* Optional cache. */ }
      releaseCache = { version: data.release.version, url: data.release.url, notes: titleSlice(data.release.notes), checkedAt: data.release.checkedAt };
      try { localStorage.setItem('kick-release-cache', JSON.stringify(releaseCache)); } catch (e) { /* Optional offline cache. */ }
      showRelease(!!data.cached);
    });
  }
  function applyAccessibility(save) {
    document.documentElement.setAttribute('data-text-size', accessibility.size);
    document.documentElement.setAttribute('data-contrast', accessibility.contrast ? 'high' : 'normal');
    el('text-size').textContent = t(accessibility.size === 'large' ? 'text_large' : 'text_normal');
    el('text-size').setAttribute('aria-pressed', accessibility.size === 'large' ? 'true' : 'false');
    el('high-contrast').textContent = t(accessibility.contrast ? 'contrast_on' : 'contrast_off');
    el('high-contrast').setAttribute('aria-pressed', accessibility.contrast ? 'true' : 'false');
    if (save) try { localStorage.setItem('kick-accessibility', JSON.stringify(accessibility)); } catch (e) { /* Session preferences still work. */ }
    fitHome(); fitCatalog();
  }
  function closeAccessibility(focus) {
    var wasOpen = accessibilityOpen; accessibilityOpen = false; el('accessibility-dialog').hidden = true;
    if (focus && wasOpen) el('accessibility-button').focus();
  }
  function videoKey(item) {
    return item && !item.isLive && typeof item.id === 'string' && /^[a-z0-9-]{1,64}$/.test(item.id) ?
      kickChannel(input.value) + ':' + item.id : '';
  }
  function watchedVideo(item) {
    var key = videoKey(item);
    for (var i = 0; i < watched.length; i++) if (watched[i].key === key) return watched[i];
  }
  function saveFavorites() {
    try { localStorage.setItem('kick-favorites', JSON.stringify(favorites)); } catch (e) { /* Retain session favorites. */ }
  }
  function favoriteLabels() {
    var name = kickChannel(input.value);
    ['favorite-channel', 'catalog-favorite'].forEach(function (id) {
      favoriteIcon(el(id), name); el(id).disabled = !name;
    });
    recentButtons.forEach(function (button, index) {
      favoriteIcon(recentControls[index * 3 + 1], recents[recentPage * homePageSize + index]);
    });
  }
  function favoriteIcon(button, name) {
    var saved = favorites.indexOf(name) >= 0, label = t(saved ? 'favorite_remove' : 'favorite_add');
    button.textContent = saved ? '♥' : '♡';
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.setAttribute('aria-label', label + (name ? ': ' + name : ''));
    button.setAttribute('title', label);
  }
  function closeFavoriteMove(save) {
    el('favorite-move').hidden = true;
    if (!favoriteMove) return;
    var name = favoriteMove.name;
    if (save) saveFavorites(); else favorites = favoriteMove.before;
    favoriteMove = null;
    favoritePage = Math.floor(Math.max(0, favorites.indexOf(name)) / homePageSize);
    renderFavorites(); refreshRecentStatus();
    var index = favorites.indexOf(name) - favoritePage * homePageSize;
    (favoriteControls[index * 3 + 1] || input).focus();
  }
  function moveFavorite(delta) {
    if (!favoriteMove) return;
    var index = favorites.indexOf(favoriteMove.name), target = index + delta;
    if (target >= 0 && target < favorites.length) {
      favorites.splice(index, 1); favorites.splice(target, 0, favoriteMove.name);
      favoritePage = Math.floor(target / homePageSize);
      renderFavorites(); refreshRecentStatus();
    }
    index = favorites.indexOf(favoriteMove.name);
    el('favorite-move-info').textContent = t('favorite_position', { name: favoriteMove.name, position: index + 1, total: favorites.length });
    el('favorite-move-up').disabled = index === 0;
    el('favorite-move-down').disabled = index === favorites.length - 1;
  }
  function renderFavorites() {
    Object.keys(recentStatus).forEach(function (name) {
      if (favorites.indexOf(name) < 0 && recents.indexOf(name) < 0) delete recentStatus[name];
    });
    var list = el('favorite-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    favoriteButtons = []; favoriteControls = [];
    var pages = Math.max(1, Math.ceil(favorites.length / homePageSize));
    favoritePage = Math.max(0, Math.min(favoritePage, pages - 1));
    el('favorites-section').hidden = !favorites.length;
    el('favorite-pages').hidden = pages <= 1;
    el('favorite-previous').disabled = favoritePage === 0;
    el('favorite-next').disabled = favoritePage === pages - 1;
    el('favorite-number').textContent = (favoritePage + 1) + ' / ' + pages;
    favorites.slice(favoritePage * homePageSize, favoritePage * homePageSize + homePageSize).forEach(function (name) {
      var row = document.createElement('div'), play = document.createElement('button'), move = document.createElement('button'), remove = document.createElement('button');
      var label = document.createElement('span'), state = document.createElement('span');
      row.className = 'favorite-row'; play.type = move.type = remove.type = 'button';
      label.textContent = name; state.className = 'favorite-state'; play.appendChild(label); play.appendChild(state);
      play.addEventListener('click', function () { startChannel(name, true); });
      move.textContent = '↕'; move.setAttribute('aria-label', t('move_favorite') + ': ' + name);
      move.addEventListener('click', function () {
        favoriteMove = { name: name, before: favorites.slice() };
        el('favorite-move').hidden = false; moveFavorite(0);
        (!el('favorite-move-up').disabled ? el('favorite-move-up') : !el('favorite-move-down').disabled ? el('favorite-move-down') : el('favorite-move-save')).focus();
      });
      remove.textContent = '♥'; remove.setAttribute('aria-label', t('favorite_remove') + ': ' + name); remove.setAttribute('aria-pressed', 'true');
      remove.addEventListener('click', function () {
        cancelRecentStatus(); favorites = favorites.filter(function (value) { return value !== name; });
        saveFavorites(); renderFavorites(); refreshRecentStatus(); (favoriteControls[0] || input).focus();
      });
      row.appendChild(play); row.appendChild(move); row.appendChild(remove); list.appendChild(row);
      favoriteButtons.push(play); favoriteControls.push(play, move, remove);
    });
    favoriteLabels(); showRecentStatus(); fitHome();
  }
  function toggleFavorite() {
    toggleNamedFavorite(kickChannel(input.value));
  }
  function toggleNamedFavorite(name) {
    closeFavoriteMove(false);
    var index = favorites.indexOf(name);
    if (!name) return;
    if (index < 0 && favorites.length >= 50) { el(screen === 'catalog' ? 'catalog-favorite-feedback' : 'favorite-feedback').textContent = t('favorites_limit'); fitHome(); fitCatalog(); return; }
    el(screen === 'catalog' ? 'catalog-favorite-feedback' : 'favorite-feedback').textContent = ''; fitHome(); fitCatalog();
    cancelRecentStatus();
    if (index < 0) favorites.push(name); else favorites.splice(index, 1);
    favoritePage = Math.floor(Math.max(0, favorites.indexOf(name)) / homePageSize);
    saveFavorites(); renderFavorites(); refreshRecentStatus();
  }
  function visibleStatusNames() {
    return favorites.slice(favoritePage * homePageSize, favoritePage * homePageSize + homePageSize).concat(recents.slice(recentPage * homePageSize, recentPage * homePageSize + homePageSize)).filter(function (name, index, all) { return all.indexOf(name) === index; });
  }
  function resumePosition(item) {
    var entry = watchedVideo(item), length = Number(item.duration) || entry && entry.duration || 0;
    return entry && !entry.finished && entry.position > 0 && (!length || entry.position < length - 30) ? entry.position : 0;
  }
  function closeResume(restore) {
    resumeItem = null;
    el('resume-choice').hidden = true;
    if (restore && resumeFocus && resumeFocus.parentNode) resumeFocus.focus();
    resumeFocus = null;
  }
  function chooseVideo(item) {
    cancelRequest();
    if(runtime&&runtime.browser&&runtime.initial&&!browserAutoStarted&&item.id===runtime.initial.video){browserAutoStarted=true;startVideo(item,runtime.initial.position);return;}
    var at = resumePosition(item);
    if (!at) { startVideo(item, 0); return; }
    resumeFocus = document.activeElement; resumeItem = item;
    el('resume-info').textContent = item.title;
    el('resume-continue').textContent = t('resume_at', { time: formatTime(at) });
    el('resume-choice').hidden = false;
    el('resume-continue').focus();
  }
  function cancelContinue() {
    continueGeneration++;
    continueRequests.forEach(function (work) {
      clearTimeout(work.timer);
      work.bridge.onservicecallback = function () {};
      try { work.bridge.cancel(); } catch (e) { /* Closed bridge. */ }
    });
    continueRequests = [];
  }
  function renderContinue() {
    cancelContinue(); continueControls = [];
    var list = el('continue-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var entries = watched.filter(function (entry) {
      return !entry.finished && (!entry.duration || entry.position < entry.duration - 30);
    });
    var pages = Math.max(1, Math.ceil(entries.length / homePageSize));
    continuePage = Math.max(0, Math.min(continuePage, pages - 1));
    el('continue-section').hidden = !entries.length;
    el('continue-pages').hidden = pages <= 1;
    el('continue-previous').disabled = continuePage === 0;
    el('continue-next').disabled = continuePage === pages - 1;
    el('continue-number').textContent = (continuePage + 1) + ' / ' + pages;
    var rows = entries.slice(continuePage * homePageSize, continuePage * homePageSize + homePageSize).map(function (entry) {
      var parts = entry.key.split(':'), row = document.createElement('div'), button = document.createElement('button'), remove = document.createElement('button');
      row.className = 'continue-row'; button.type = remove.type = 'button';
      button.textContent = t('continue_named', { channel: parts[0], title: t('replay'), time: formatTime(entry.position) });
      button.addEventListener('click', function () { startChannel(parts[0], false, parts[1]); });
      remove.textContent = '×'; remove.setAttribute('aria-label', t('remove_history'));
      remove.addEventListener('click', function () {
        watched = watched.filter(function (other) { return other.key !== entry.key; });
        historyDirty = true; saveWatched(); renderContinue(); (continueControls[0] || input).focus();
      });
      row.appendChild(button); row.appendChild(remove); list.appendChild(row); continueControls.push(button, remove);
      return { entry: entry, button: button, parts: parts };
    });
    fitHome();
    if (document.hidden || navigator.onLine === false || typeof PalmServiceBridge === 'undefined') return;
    var token = continueGeneration, next = 0;
    function worker() {
      if (token !== continueGeneration || screen !== 'home' || document.hidden || next >= rows.length) return;
      var row = rows[next++], bridge, work, done = false;
      try { bridge = new PalmServiceBridge(); } catch (e) { return; }
      work = { bridge: bridge };
      continueRequests.push(work);
      function finish(data) {
        if (done || token !== continueGeneration) return;
        done = true;
        clearTimeout(work.timer);
        continueRequests = continueRequests.filter(function (other) { return other !== work; });
        bridge.onservicecallback = function () {};
        try { bridge.cancel(); } catch (e) { /* Closed bridge. */ }
        var video = data && data.returnValue && data.video && data.video.id === row.parts[1] ? data.video : null;
        if (video) setVideoTitle(row.button, t('continue_named', { channel: row.parts[0], title: typeof video.title === 'string' ? titleSlice(video.title) : t('replay'), time: formatTime(row.entry.position) }));
        else row.button.setAttribute('aria-label', row.button.textContent + '. ' + t('continue_unavailable'));
        worker();
      }
      bridge.onservicecallback = function (response) {
        var data;
        try { if (typeof response !== 'string' || response.length > 1048576) throw Error('response'); data = JSON.parse(response); } catch (e) { data = null; }
        finish(data);
      };
      work.timer = setTimeout(function () { finish(null); }, 18000);
      try { bridge.call('luna://com.jakubjirak.service/replay', JSON.stringify({ channel: row.parts[0], id: row.parts[1], background: true })); }
      catch (e) { finish(null); }
    }
    worker(); worker();
  }
  function saveWatched() {
    if (!historyDirty) return;
    try { localStorage.setItem('kick-watched-videos', JSON.stringify(watched)); } catch (e) { /* Keep this session's history if storage is unavailable. */ }
    historyDirty = false; historyWrittenAt = Date.now();
  }
  function rememberVideo(position, duration, ended) {
    var key = videoKey(current), previous = watchedVideo(current);
    if (!key || ended && !previous || !isFinite(position) || position <= 0) return;
    var entry = previous || { key: key, finished: false };
    entry.position = Math.min(position, 2592000);
    entry.duration = isFinite(duration) && duration > 0 ? Math.min(duration, 2592000) : 0;
    entry.finished = !!ended || entry.finished && current.startAt !== 0;
    if (watched[0] !== entry) watched = [entry].concat(watched.filter(function (other) {
      return other.key !== key;
    })).slice(0, 200);
    historyDirty = true;
    if (!previous || ended || Date.now() - historyWrittenAt >= 10000) saveWatched();
  }

  function setScreen(name) {
    if(name!=='watch'){speedEpoch++;openingSpeed=false;if(runtime&&!runtime.browser)runtime.cancelOpen(false);}
    closeSpeed();closeAccessibility(false); closeJump(false); closeSearch(false, false); closeQuality(); closeFavoriteMove(false); closeResume(false); cancelContinue();
    screen = name;
    cancelHomeLayout(); cancelCatalogLayout();
    ['home', 'catalog', 'watch', 'about'].forEach(function (id) { el(id).hidden = id !== name; });
    window.scrollTo(0, 0);
    if (browse) browse.setVisible(name === 'home');
    if (name === 'home' && (!browse || browse.mode() === 'library')) { renderContinue(); refreshRecentStatus(); fitHome(); } else cancelRecentStatus();
  }
  function cancelRequest() {
    generation++;
    clearTimeout(requestTimer);
    var previous = request;
    request = null;
    if (previous) { try { previous.cancel(); } catch (e) { /* A closed bridge is already cancelled. */ } }
  }
  function unload() {
    saveWatched();
    clearTimeout(controlsTimer);
    preparing = false;
    el('toggle').disabled = false; el('quality-button').disabled = true; closeJump(false); closeQuality();
    player.stop();
  }
  function goHome() {
    if(runtime&&runtime.browser){saveWatched();runtime.update(playback,speedPreference);runtime.finish();player.stop();return;}
    cancelRequest();
    current = null;
    unload();
    catalog = null;
    clearVideos();
    setScreen('home');
    if (browse) browse.focus(); else input.focus();
  }
  function clearVideos() {
    videoButtons = [];
    var list = el('videos');
    while (list.firstChild) list.removeChild(list.firstChild);
  }
  function renderRecents() {
    var list = el('recent-channels');
    while (list.firstChild) list.removeChild(list.firstChild);
    recentButtons = []; recentControls = [];
    el('recent').hidden = !recents.length;
    var pages = Math.max(1, Math.ceil(recents.length / homePageSize));
    recentPage = Math.max(0, Math.min(recentPage, pages - 1));
    recents.slice(recentPage * homePageSize, recentPage * homePageSize + homePageSize).forEach(function (name) {
      var row = document.createElement('div'); row.className = 'recent-row';
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'recent-play';
      var label = document.createElement('span');
      label.className = 'recent-name'; label.textContent = name; button.appendChild(label);
      var live = document.createElement('span');
      live.className = 'recent-live'; live.textContent = t('live_badge'); live.hidden = true; button.appendChild(live);
      button.addEventListener('click', function () { startChannel(name, true); });
      var favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = 'recent-favorite'; favoriteIcon(favorite, name);
      favorite.addEventListener('click', function () { toggleNamedFavorite(name); });
      var remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'recent-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', t('remove_channel_named', { name: name }));
      remove.setAttribute('title', t('remove_channel'));
      remove.addEventListener('click', function () {
        cancelRecentStatus();
        var index = recentButtons.indexOf(button);
        recents = recents.filter(function (item) { return item !== name; });
        delete recentStatus[name]; saveRecents(); renderRecents();
        if (input.value === name) input.value = recents[0] || '';
        favoriteLabels();
        (recentButtons[Math.min(index, recentButtons.length - 1)] || input).focus();
        refreshRecentStatus();
      });
      row.appendChild(button); row.appendChild(favorite); row.appendChild(remove); list.appendChild(row);
      recentButtons.push(button); recentControls.push(button, favorite, remove);
    });
    el('recent-pages').hidden = pages <= 1;
    el('recent-previous').disabled = recentPage === 0;
    el('recent-next').disabled = recentPage === pages - 1;
    el('recent-page-number').textContent = (recentPage + 1) + ' / ' + pages;
    favoriteLabels(); showRecentStatus(); fitHome();
  }
  function showRecentStatus() {
    favoriteButtons.forEach(function (button, index) {
      var name = favorites[favoritePage * homePageSize + index], value = recentStatus[name];
      var live = value && Date.now() - value.at < 60000 ? value.live : null;
      var status = t(live === true ? 'live_badge' : live === false ? 'offline_status' : 'unknown_status');
      button.children[1].textContent = status; button.setAttribute('aria-label', name + ', ' + status);
    });
    recentButtons.forEach(function (button, index) {
      var name = recents[recentPage * homePageSize + index], status = recentStatus[name];
      var live = !!(status && status.live === true && Date.now() - status.at < 60000);
      button.children[1].hidden = !live;
      button.setAttribute('aria-label', name + (live ? ', ' + t('live_now') : ''));
    });
  }
  function cancelRecentStatus() {
    recentGeneration++; clearTimeout(recentTimer);
    var request = recentRequest; recentRequest = null;
    if (request) { try { request.cancel(); } catch (e) { /* The status connection may already be closed. */ } }
  }
  function refreshRecentStatus() {
    cancelRecentStatus();
    var visible = visibleStatusNames();
    if (screen !== 'home' || document.hidden || !visible.length) return;
    showRecentStatus();
    var names = visible.filter(function (name) {
      return !recentStatus[name] || Date.now() - recentStatus[name].at >= 60000;
    }).slice(0, 6);
    if (!names.length || navigator.onLine === false || typeof PalmServiceBridge === 'undefined') {
      var delay = 60000;
      if (!names.length) visible.forEach(function (name) {
        delay = Math.min(delay, Math.max(1, 60000 - (Date.now() - recentStatus[name].at)));
      });
      recentTimer = setTimeout(refreshRecentStatus, delay); return;
    }
    var token = recentGeneration;
    function finish(data) {
      if (token !== recentGeneration) return;
      cancelRecentStatus();
      names.forEach(function (name) { recentStatus[name] = { live: null, at: Date.now() }; });
      if (data && data.returnValue && Array.isArray(data.statuses)) data.statuses.slice(0, 6).forEach(function (status) {
        if (status && names.indexOf(status.channel) !== -1 && typeof status.live === 'boolean')
          recentStatus[status.channel] = { live: status.live, at: Date.now() };
      });
      refreshRecentStatus();
    }
    try {
      recentRequest = new PalmServiceBridge();
      recentRequest.onservicecallback = function (response) {
        var data;
        try { if (typeof response === 'string' && response.length <= 4096) data = JSON.parse(response); } catch (e) { /* Show no status for malformed replies. */ }
        finish(data);
      };
      recentTimer = setTimeout(function () { finish(null); }, 40000);
      recentRequest.call('luna://com.jakubjirak.service/statuses', JSON.stringify({ channels: names }));
    } catch (e) { finish(null); }
  }
  function saveRecents() {
    try {
      localStorage.setItem('kick-recent-channels', JSON.stringify(recents));
      localStorage.setItem('kick-channel', recents[0] || '');
    } catch (e) { /* Optional storage. */ }
  }
  function remember(name) {
    recents = [name].concat(recents.filter(function (item) { return item !== name; })).slice(0, 50);
    recentPage = 0;
    Object.keys(recentStatus).forEach(function (key) { if (recents.indexOf(key) === -1 && favorites.indexOf(key) === -1) delete recentStatus[key]; });
    saveRecents();
    renderRecents();
  }
  function hideControls() {
    if(screen!=='watch')return;
    clearTimeout(controlsTimer);
    hidingControls=true;el('watch').focus();hidingControls=false;
    el('playback-controls').hidden=true;el('back').hidden=true;
  }
  function showControls() {
    if (screen !== 'watch') return;
    el('playback-controls').hidden = false;
    el('back').hidden = false;
    clearTimeout(controlsTimer);
    if (!playback.paused && !playback.seeking && !scrubbing && !preparing && !jumpOpen && el('quality-choice').hidden && el('speed-choice').hidden && el('playback-status').hidden) {
      controlsTimer = setTimeout(function () {
        hideControls();
      }, 6000);
    }
  }
  function callService(method, payload, callback) {
    cancelRequest();
    var token = generation;
    try { request = new PalmServiceBridge(); }
    catch (e) { callback({ errorText: t('service_unavailable') }); return; }
    request.onservicecallback = function (response) {
      if (token !== generation) return;
      var data;
      try {
        if (typeof response !== 'string' || response.length > 1048576) throw new Error('response size');
        data = JSON.parse(response);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('response');
      }
      catch (e) { data = { errorText: t('invalid_response') }; }
      cancelRequest();
      callback(data);
    };
    requestTimer = setTimeout(function () {
      if (token !== generation) return;
      cancelRequest();
      callback({ errorText: t('no_response') });
    }, 18000);
    try { request.call('luna://com.jakubjirak.service/' + method, JSON.stringify(payload)); }
    catch (e) {
      cancelRequest();
      callback({ errorText: t('service_unavailable') });
    }
  }
  // Chromium 38 on webOS 3 has no Array.from; preserve complete surrogate pairs.
  function titleSlice(text) {
    var end = 0, count = 0;
    while (end < text.length && count < 200) {
      var first = text.charCodeAt(end++), second = text.charCodeAt(end);
      if (first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF) end++;
      count++;
    }
    return text.slice(0, end);
  }
  // Service failures carry a code for translation; free text is the bounded fallback.
  function serviceError(reply, fallbackKey) {
    var code = reply && reply.errorCode, params = reply && reply.errorParams, text = reply && reply.errorText;
    if (typeof code === 'string' && /^[a-z_]{1,32}$/.test(code) &&
      Object.prototype.hasOwnProperty.call(KickI18n.strings.en, 'svc_' + code)) {
      var safe = {};
      if (params && typeof params === 'object') Object.keys(params).slice(0, 4).forEach(function (key) {
        var value = params[key];
        if (/^[a-z]{1,16}$/.test(key) && (typeof value === 'number' && isFinite(value) || typeof value === 'string' && value.length <= 64)) safe[key] = value;
      });
      return t('svc_' + code, safe);
    }
    return typeof text === 'string' && text ? titleSlice(text) : t(fallbackKey);
  }
  function mediaStatus(key, params) {
    // Player statuses are i18n keys; a nested reason key is translated before substitution.
    var values = { retry: t('retry'), resume: t('resume') };
    if (params) Object.keys(params).forEach(function (name) { values[name] = params[name]; });
    if (typeof values.reason === 'string') values.reason = t(values.reason, values.reasonParams);
    var message = key ? t(key, values) : '';
    if (el('playback-status').textContent === message) return;
    el('playback-status').textContent = message;
    el('playback-status').hidden = !message;
    if (message) showControls();
  }
  // BMP emoji covered by the bundled font. ASCII stays in ordinary text spans. Compiled once per page load.
  var symbols = (function () {
    var bmp = '\u00A9\u00AE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9-\u21AA\u231A-\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA-\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614-\u2615\u2618\u261D\u2620\u2622-\u2623\u2626\u262A\u262E-\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F-\u2660\u2663\u2665-\u2666\u2668\u267B\u267E-\u267F\u2692-\u2697\u2699\u269B-\u269C\u26A0-\u26A1\u26A7\u26AA-\u26AB\u26B0-\u26B1\u26BD-\u26BE\u26C4-\u26C5\u26C8\u26CE-\u26CF\u26D1\u26D3-\u26D4\u26E9-\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733-\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763-\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934-\u2935\u2B05-\u2B07\u2B1B-\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299';
    var atom = '(?:[' + bmp + ']|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF])';
    var part = atom + '(?:[\\uFE0E\\uFE0F]|\\uD83C[\\uDFFB-\\uDFFF]|\\uDB40[\\uDC20-\\uDC7F])*';
    return new RegExp('[#*0-9]\\uFE0F?\\u20E3|(?:\\uD83C[\\uDDE6-\\uDDFF]){2}|' + part + '(?:\\u200D' + part + ')*', 'g');
  }());
  function setVideoTitle(node, value) {
    var text = titleSlice(String(value || t('replay')));
    node.textContent = '';
    var index = 0, match;
    symbols.lastIndex = 0;
    function append(value, className) {
      if (!value) return;
      var span = document.createElement('span');
      if (className) span.className = className;
      span.textContent = value; node.appendChild(span);
    }
    // Isolate whole emoji sequences to avoid webOS 5's repeated-glyph corruption.
    while ((match = symbols.exec(text)) !== null) {
      append(text.slice(index, match.index), '');
      append(match[0], /^[#*0-9]/.test(match[0]) ? 'title-symbol title-keycap' : 'title-symbol');
      index = match.index + match[0].length;
    }
    append(text.slice(index), '');
  }
  function closeQuality() {
    el('quality-choice').hidden = true; qualityButtons = [];
  }
  function validVariant(v) {
    return v && typeof v.url === 'string' && v.url.length < 4096 &&
      /^https:\/\/(?:stream\.kick\.com|(?:[a-z0-9-]+\.)+live-video\.net)\/[^\s?#]+\.m3u8(?:\?[^\s#]*)?$/.test(v.url) &&
      typeof v.height === 'number' && v.height > 0 && v.height <= 2160 && typeof v.width === 'number' && v.width > 0 && v.width <= 3840 &&
      typeof v.bitrate === 'number' && v.bitrate > 0 && v.bitrate <= 200000000 && typeof v.fps === 'number' && v.fps >= 0 && v.fps <= 240;
  }
  function applyQuality(remount, choice) {
    if (!current) return;
    var selected = choice || null;
    // Prefer <=720p and effective <=60 fps. If rendition metadata cannot meet
    // that budget, explicitly label the lowest available best-effort fallback.
    // Never change the native quality preference for this automatic choice.
    var acceleratedFallback = false;
    if (!selected && runtime && runtime.browser && !acceleratedQuality && speedPreference > 1) {
      selected = current.variants.filter(function (v) { return v.manual && v.height <= 720 && v.fps > 0 && v.fps * speedPreference <= 60; })[0] || null;
      if (!selected) { selected = current.variants.filter(function (v) { return v.manual; }).slice(-1)[0] || null; acceleratedFallback = !!selected; }
    }
    if (!selected && qualityPreference !== 'auto') current.variants.some(function (v) {
      if (v.manual && String(v.height) === qualityPreference) { selected = v; return true; } return false;
    });
    current.playback = current.playback || { url: current.url, best: current.best, duration: current.duration, isLive: current.isLive, startAt: current.startAt };
    var url = selected ? selected.url : current.url, best = selected || current.best;
    el('quality-selection').textContent = selected ? t('quality_fixed', { quality: selected.height + 'p', fps: selected.fps || '?' }) :
      qualityPreference === 'auto' ? t('quality_auto') : t('quality_fallback');
    el('quality-actual').textContent = t('quality_actual_unavailable');
    if (acceleratedFallback) el('quality-selection').textContent += t.language === 'ru' ? ' · минимальное доступное для ускорения' : ' · lowest available for accelerated playback';
    if (remount) player.changeSource(url, best);
    current.playback.url = url; current.playback.best = best;
  }
  function openQuality() {
    if (!current || !current.prepared || preparing || playback.network) return;
    var owner = current;
    var list = el('quality-options'); while (list.firstChild) list.removeChild(list.firstChild);
    qualityButtons = [];
    function add(label, variant) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.disabled = !!variant && !variant.manual;
      button.addEventListener('click', function () {
        if (button.disabled || el('quality-choice').hidden || current !== owner || playback.network) return;
        acceleratedQuality = !!(runtime && runtime.browser);
        qualityPreference = variant ? String(variant.height) : 'auto';
        try { localStorage.setItem('kick-quality-preference', qualityPreference); } catch (e) { /* Session preference remains usable. */ }
        applyQuality(true, variant); closeQuality(); showControls(); el('quality-button').focus();
      });
      list.appendChild(button); if (!button.disabled) qualityButtons.push(button);
    }
    add(t('quality_auto'), null);
    current.variants.forEach(function (v) { add(v.height + 'p' + (v.fps ? ' · ' + v.fps + ' fps' : '') + (v.manual ? '' : ' · ' + t('quality_audio_unsupported')), v); });
    qualityButtons.push(el('quality-cancel')); el('quality-choice').hidden = false; showControls(); qualityButtons[0].focus();
  }
  function refreshSource(done) {
    var item = current, name = kickChannel(input.value);
    if (!item || screen !== 'watch' || document.hidden) { done(null); return; }
    var payload = { channel: name };
    if (!item.isLive) {
      if (!/^[a-z0-9-]{1,64}$/.test(item.id || '')) { done(null, true); return; }
      payload.id = item.id;
    }
    callService(item.isLive ? 'channel' : 'replay', payload, function (data) {
      if (current !== item || document.hidden || screen !== 'watch') return;
      var fresh = data.returnValue && (item.isLive ? data.channel === name && data.live : data.video && data.video.id === item.id && data.video);
      if (!fresh) { done(null, !!data.returnValue); return; }
      if (!validVariant({ url: fresh.url, height: 1, width: 1, bitrate: 1, fps: 0 })) { done(null); return; }
      callService('prepare', { url: fresh.url }, function (prepared) {
        if (current !== item || document.hidden || screen !== 'watch') return;
        if (!prepared.returnValue) { done(null); return; }
        item.url = fresh.url;
        item.variants = Array.isArray(prepared.variants) ? prepared.variants.slice(0, 64).filter(validVariant) : [];
        item.best = prepared.best && typeof prepared.best.bitrate === 'number' && prepared.best.bitrate > 0 && prepared.best.bitrate <= 200000000 ? prepared.best : null;
        if (item.best) el('quality').textContent = t('best_quality', { quality: item.best.height === 2160 ? '4K' : item.best.height + 'p' }) + (item.best.fps ? t('fps_suffix', { fps: item.best.fps }) : '');
        applyQuality(false); done(item.playback);
      });
    });
  }
  function startVideo(item, startAt) {
    if (!item || typeof item.url !== 'string' ||
      !/^https:\/\/(?:stream\.kick\.com|(?:[a-z0-9-]+\.)+live-video\.net)\/[^\s?#]+\.m3u8(?:\?[^\s#]*)?$/.test(item.url)) {
      el('videos-status').textContent = t('invalid_video_url'); fitCatalog();
      return;
    }
    item.startAt = startAt || 0;
    item.prepared = false; item.playback = null; item.variants = []; item.best = null;
    current = item;
    scrubbing = false;
    setScreen('watch');
    setVideoTitle(el('video-title'), (item.isLive ? t('live_badge') + ' · ' : '') + item.title);
    el('timeline').hidden = el('jump-time').hidden = !!item.isLive;
    el('speed-button').hidden=!!item.isLive;speedLabel();
    el('seek').value = 0;
    el('seek').max = 0;
    el('quality').textContent = t('quality_default');
    el('toggle').textContent = t('pause');
    unload();
    mediaStatus('loading_quality');
    preparing = true;
    el('toggle').disabled = true; el('quality-button').disabled = true;
    callService('prepare', { url: item.url }, function (data) {
      if (current !== item) return;
      preparing = false;
      el('toggle').disabled = false;
      var best = data.returnValue && data.best;
      item.best = best && typeof best.bitrate === 'number' && isFinite(best.bitrate) && best.bitrate > 0 &&
        typeof best.height === 'number' && best.height > 0 && best.height <= 2160 ? best : null;
      if (item.best) el('quality').textContent = t('best_quality', { quality: item.best.height === 2160 ? '4K' : item.best.height + 'p' }) +
        (item.best.fps ? t('fps_suffix', { fps: item.best.fps }) : '');
      item.variants = data.returnValue && Array.isArray(data.variants) ? data.variants.slice(0, 64).filter(validVariant) : [];
      item.prepared = true; item.playback = null; applyQuality(false); el('quality-button').disabled = false;
      if (!document.hidden) {
        // Recording playback always starts here. A remembered speed must not
        // silently move a viewer into the TV browser's pointer-only interface.
        if(player.setRate)player.setRate(runtime&&runtime.browser?speedPreference:1);
        player.load(item.playback);
      }
      else mediaStatus('playback_stopped');
    });
    el('watch').focus();
  }
  function showCatalog() {
    if(runtime&&runtime.browser&&screen==='watch'){saveWatched();runtime.update(playback,speedPreference);runtime.finish();player.stop();return;}
    cancelRequest();
    current = null;
    unload();
    setScreen('catalog');
    renderVideos();
    (catalog && catalog.live ? el('live') : videoButtons[0] || el('catalog-back')).focus();
  }
  function renderVideos() {
    var list = el('videos');
    while (list.firstChild) list.removeChild(list.firstChild);
    videoButtons = [];
    var all = filteredVideos();
    el('search-summary').textContent = el('replay-result-count').textContent = t('results_count', { count: all.length });
    var count = Math.max(1, Math.ceil(all.length / catalogPageSize));
    page = Math.max(0, Math.min(page, count - 1));
    all.slice(page * catalogPageSize, page * catalogPageSize + catalogPageSize).forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      var preview = document.createElement('span');
      preview.className = 'video-preview';
      preview.setAttribute('aria-hidden', 'true');
      if (typeof item.thumbnail === 'string' && /^https:\/\/(?:files|images)\.kick\.com\/[^\s#]+$/.test(item.thumbnail)) {
        var img = document.createElement('img');
        img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
        img.addEventListener('error', function () { img.hidden = true; });
        img.src = item.thumbnail;
        preview.appendChild(img);
      }
      button.appendChild(preview);
      var title = document.createElement('span');
      title.className = 'video-title'; setVideoTitle(title, item.title);
      button.appendChild(title);
      var details = document.createElement('small');
      var seconds = Number(item.duration);
      var minutes = isFinite(seconds) && seconds > 0 ? Math.floor(seconds / 60) : 0;
      details.textContent = String(item.date || '').slice(0, 10) + ' · ' + t('duration_hm', { h: Math.floor(minutes / 60), m: minutes % 60 });
      button.appendChild(details);
      var entry = watchedVideo(item);
      if (entry) {
        var badge = document.createElement('span');
        badge.className = 'watched-badge';
        badge.textContent = entry.finished ? t('watched_finished') : t('watched_at', { time: formatTime(entry.position) });
        preview.appendChild(badge);
        var latest = watched[0].key === entry.key;
        if (latest) {
          var last = document.createElement('span');
          last.className = 'last-watched'; last.textContent = t('last_watched');
          preview.appendChild(last);
        }
        if (entry.duration) {
          var progress = document.createElement('progress');
          progress.className = 'watched-progress'; progress.max = entry.duration;
          progress.value = entry.finished ? entry.duration : Math.min(entry.position, entry.duration);
          preview.appendChild(progress);
        }
        button.setAttribute('aria-label', title.textContent + ', ' + details.textContent + ', ' +
          (latest ? t('last_watched') + ', ' : '') + badge.textContent);
      }
      button.addEventListener('click', function () { chooseVideo(item); });
      list.appendChild(button); videoButtons.push(button);
    });
    el('pages').hidden = count <= 1;
    el('previous-page').disabled = page === 0;
    el('next-page').disabled = page === count - 1;
    el('page-number').textContent = (page + 1) + ' / ' + count;
    fitCatalog();
  }
  function renderCatalog(data) {
    catalog = data; page = 0; catalogQuery = ''; catalogFilter = 'all'; catalogOrder = 'newest';
    recentStatus[kickChannel(input.value)] = { live: !!data.live, at: Date.now() };
    data.videos = data.videos.filter(function (v) { return v && typeof v.url === 'string'; }).slice(0, 30);
    el('channel-status').textContent = t(data.live ? 'status_live' : 'status_offline');
    el('live').hidden = !data.live;
    var videosError = data.videosError && typeof data.videosError === 'object' ? serviceError(data.videosError, 'svc_videos_unavailable') : '';
    el('catalog-retry').hidden = !videosError;
    el('videos-status').textContent = videosError || (data.videos.length ? '' : t('no_replays'));
  }
  function startChannel(value, autoplay, replayId) {
    var name = kickChannel(value);
    if (!name) {
      el('error').textContent = t('invalid_channel_input'); fitHome();
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (navigator.onLine === false) {
      el(screen === 'catalog' ? 'channel-status' : 'error').textContent = t('offline'); fitHome();
      return;
    }
    input.value = name; favoriteLabels();
    input.removeAttribute('aria-invalid');
    el('error').textContent = ''; fitHome();
    cancelRequest();
    current = null;
    unload();
    catalog = null;
    clearVideos();
    el('pages').hidden = true;
    el('catalog-retry').hidden = true;
    el('live').hidden = true;
    el('catalog-heading').textContent = name;
    el('channel-status').textContent = t('loading_channel');
    el('videos-status').textContent = '';
    setScreen('catalog');
    el('catalog-back').focus();
    if (typeof PalmServiceBridge === 'undefined') {
      el('channel-status').textContent = t('needs_service');
      return;
    }
    callService('channel', { channel: name }, function (data) {
      if (!data.returnValue || !Array.isArray(data.videos)) {
        el('channel-status').textContent = serviceError(data, 'channel_failed');
        el('catalog-retry').hidden = false;
        return;
      }
      remember(name);
      renderCatalog(data);
      if (autoplay && data.live && !document.hidden) startVideo(data.live);
      else {
        showCatalog();
        if (replayId) {
          el('videos-status').textContent = t('continue_loading'); fitCatalog();
          callService('replay', { channel: name, id: replayId }, function (reply) {
            var selected = reply.returnValue && reply.video && reply.video.id === replayId ? reply.video : null;
            el('videos-status').textContent = selected ? '' : t('continue_unavailable'); fitCatalog();
            if (selected && !document.hidden) chooseVideo(selected);
          });
        }
      }
    });
  }
  function toggle() {
    if (!current || preparing) return;
    if (playback.phase === 'idle') { if (current.prepared) player.load(current.playback || current); else startVideo(current, current.startAt); } else if (playback.phase === 'error') player.play(); else player.toggle();
    showControls();
  }
  function seek(seconds) {
    if (!current || current.isLive || preparing) return;
    player.seekBy(seconds);
    showControls();
  }
  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds) || 0);
    var h = Math.floor(seconds / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = seconds % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function updateTimeline() {
    if (!current || current.isLive) return;
    var position = Math.floor(scrubbing ? Number(el('seek').value) : playback.position);
    var duration = Math.floor(playback.duration);
    var state = playback.ready + ':' + position + ':' + duration + ':' + scrubbing;
    if (timelineState === state) return;
    timelineState = state;
    el('seek').disabled = !playback.ready;
    el('seek').max = duration;
    if (!scrubbing) el('seek').value = position;
    el('seek-progress').max = duration || 1;
    el('seek-progress').value = position;
    var elapsed = formatTime(position), total = formatTime(duration);
    el('elapsed').textContent = elapsed;
    el('duration').textContent = total;
    el('seek').setAttribute('aria-valuetext', t('time_of', { elapsed: elapsed, total: total }));
  }
  function speedLabel(){el('speed-button').textContent=speedWords.button+(runtime&&runtime.browser?speedPreference:1)+'×';}
  function closeSpeed(){el('speed-choice').hidden=true;speedButtons=[];}
  function openAccelerated(position){
    if(openingSpeed||!current||current.isLive||!runtime||runtime.browser||runtime.remotePlayback!==true)return;
    var item=current, token=++speedEpoch;openingSpeed=true;player.pause();saveWatched();
    el('playback-status').textContent=speedWords.opening;showControls();
    runtime.open({channel:kickChannel(input.value),id:item.id},speedPreference,position||0,function(ok){
      if(token!==speedEpoch||current!==item||document.hidden)return;openingSpeed=false;
      if(!ok){speedPreference=1;try{localStorage.setItem('kick-speed-preference','1');}catch(e){}speedLabel();if(!document.hidden){item.playback.startAt=position||0;player.load(item.playback);el('playback-status').textContent=speedWords.failed;}}
    },function(){return token===speedEpoch&&current===item&&screen==='watch'&&!document.hidden;});
  }
  function collectAccelerated(){
    if(!runtime||runtime.browser||collectingSpeed)return;
    collectingSpeed=true;
    runtime.collect(function(value){
      collectingSpeed=false;if(!value)return;
      hydrateStorage();renderRecents();renderFavorites();speedLabel();
      if(catalog){current=null;unload();setScreen('catalog');renderVideos();(videoButtons[0]||el('catalog-back')).focus();}
      else startChannel(value.initial.channel,false);
    });
  }
  closeSpeed();speedLabel();el('speed-heading').textContent=speedWords.heading;el('speed-cancel').textContent=speedWords.cancel;
  el('speed-button').addEventListener('click',function(){
    if(!current||current.isLive||preparing||openingSpeed)return;
    var list=el('speed-options');while(list.firstChild)list.removeChild(list.firstChild);speedButtons=[];
    [1,1.25,1.5,1.75,2].forEach(function(rate){var button=document.createElement('button');button.type='button';var available=rate===1||!!(runtime&&(runtime.browser||runtime.remotePlayback===true));button.disabled=!available;button.textContent=rate+'×'+(rate===(runtime&&runtime.browser?speedPreference:1)?' ✓':'');
      button.addEventListener('click',function(){speedPreference=rate;try{localStorage.setItem('kick-speed-preference',String(rate));}catch(e){}closeSpeed();speedLabel();showControls();
        if(runtime&&runtime.browser){player.setRate(rate);runtime.update(playback,rate);el('speed-button').focus();}
        else if(rate>1)openAccelerated(playback.position);else{if(player.setRate)player.setRate(1);el('speed-button').focus();}
      });list.appendChild(button);if(!button.disabled)speedButtons.push(button);});
    speedButtons.push(el('speed-cancel'));el('speed-choice').hidden=false;showControls();speedButtons[0].focus();
  });
  el('speed-note').textContent=runtime&&(runtime.browser||runtime.remotePlayback===true)?'':t.language==='ru'?'Ускорение временно недоступно: дорабатываю управление с пульта. Запись остаётся в обычном плеере.':'Accelerated playback is temporarily unavailable while remote controls are being fixed. Recordings stay in this player.';
  el('hide-controls').textContent=t.language==='ru'?'Скрыть меню':'Hide controls';
  el('hide-controls').addEventListener('click',hideControls);
  el('speed-cancel').addEventListener('click',function(){closeSpeed();showControls();el('speed-button').focus();});

  el('resume-choice').hidden = true;
  closeAccessibility(false);
  el('accessibility-button').addEventListener('click', function () { accessibilityOpen = true; el('accessibility-dialog').hidden = false; el('text-size').focus(); });
  el('text-size').addEventListener('click', function () { accessibility.size = accessibility.size === 'large' ? 'normal' : 'large'; applyAccessibility(true); });
  el('high-contrast').addEventListener('click', function () { accessibility.contrast = !accessibility.contrast; applyAccessibility(true); });
  el('accessibility-reset').addEventListener('click', function () { accessibility = { size: 'normal', contrast: false }; applyAccessibility(true); });
  el('accessibility-close').addEventListener('click', function () { closeAccessibility(true); });
  el('about-button').addEventListener('click', openAbout);
  el('about-back').addEventListener('click', closeAbout);
  el('check-updates').addEventListener('click', checkUpdates);
  closeJump(false);
  el('jump-time').addEventListener('click', function () { openJump(0); });
  ['jump-hours', 'jump-minutes', 'jump-seconds'].forEach(function (id) { el(id).addEventListener('input', jumpPreview); });
  el('jump-back').addEventListener('click', function () { jumpStep(-600); });
  el('jump-forward').addEventListener('click', function () { jumpStep(600); });
  el('jump-cancel').addEventListener('click', function () { closeJump(true); });
  el('jump-confirm').addEventListener('click', function () { var target = jumpPreview(); if (target === null || !jumpOpen) return; player.seekTo(target); closeJump(true); });
  closeSearch(false, false);
  el('find-saved').addEventListener('click', function () { el('saved-query').value = ''; savedPage = 0; renderSavedSearch(); el('saved-search').hidden = false; el('saved-query').focus(); });
  el('saved-query').addEventListener('input', function () { savedPage = 0; renderSavedSearch(); });
  el('saved-clear').addEventListener('click', function () { el('saved-query').value = ''; savedPage = 0; renderSavedSearch(); el('saved-query').focus(); });
  el('saved-cancel').addEventListener('click', function () { closeSearch(false, true); });
  [-1, 1].forEach(function (delta) { el(delta < 0 ? 'saved-previous' : 'saved-next').addEventListener('click', function () { savedPage += delta; renderSavedSearch(); (savedSearchButtons[0] || el('saved-query')).focus(); }); });
  el('catalog-search').addEventListener('click', function () {
    toolsSnapshot = { catalog: catalog, query: catalogQuery, filter: catalogFilter, order: catalogOrder, page: page, offset: page * catalogPageSize };
    el('replay-query').value = catalogQuery; updateSearch(); el('replay-tools').hidden = false; el('replay-query').focus();
  });
  el('replay-query').addEventListener('input', updateSearch);
  el('replay-filter').addEventListener('click', function () { var filters = ['all', 'progress', 'unwatched', 'finished']; catalogFilter = filters[(filters.indexOf(catalogFilter) + 1) % filters.length]; updateSearch(); });
  el('replay-sort').addEventListener('click', function () { catalogOrder = catalogOrder === 'newest' ? 'oldest' : 'newest'; updateSearch(); });
  el('replay-reset').addEventListener('click', function () { el('replay-query').value = ''; catalogFilter = 'all'; catalogOrder = 'newest'; updateSearch(); el('replay-query').focus(); });
  el('replay-apply').addEventListener('click', function () { closeSearch(true, true); });
  el('replay-cancel').addEventListener('click', function () { closeSearch(false, true); });
  el('favorite-move').hidden = true;
  closeQuality();
  el('quality-button').addEventListener('click', openQuality);
  el('quality-cancel').addEventListener('click', function () { closeQuality(); showControls(); el('quality-button').focus(); });
  input.addEventListener('input', favoriteLabels);
  el('favorite-channel').addEventListener('click', toggleFavorite);
  el('catalog-favorite').addEventListener('click', toggleFavorite);
  [-1, 1].forEach(function (delta) {
    el(delta < 0 ? 'favorite-previous' : 'favorite-next').addEventListener('click', function () { cancelRecentStatus(); favoritePage += delta; renderFavorites(); refreshRecentStatus(); (favoriteControls[0] || input).focus(); });
    el(delta < 0 ? 'favorite-move-up' : 'favorite-move-down').addEventListener('click', function () {
      moveFavorite(delta);
      (el(delta < 0 ? 'favorite-move-up' : 'favorite-move-down').disabled ? el('favorite-move-save') : el(delta < 0 ? 'favorite-move-up' : 'favorite-move-down')).focus();
    });
  });
  el('favorite-move-save').addEventListener('click', function () { closeFavoriteMove(true); });
  el('favorite-move-cancel').addEventListener('click', function () { closeFavoriteMove(false); });
  el('resume-cancel').addEventListener('click', function () { closeResume(true); });
  el('resume-start').addEventListener('click', function () { var item = resumeItem; closeResume(false); if (item) startVideo(item, 0); });
  el('resume-continue').addEventListener('click', function () { var item = resumeItem, at = item && resumePosition(item); closeResume(false); if (item) startVideo(item, at); });
  [-1, 1].forEach(function (delta) {
    el(delta < 0 ? 'continue-previous' : 'continue-next').addEventListener('click', function () { continuePage += delta; renderContinue(); (continueControls[0] || input).focus(); });
  });
  el('channel-form').addEventListener('submit', function (event) { event.preventDefault(); startChannel(input.value, true); });
  el('recordings').addEventListener('click', function () { startChannel(input.value, false); });
  el('catalog-back').addEventListener('click', goHome);
  function turnRecentPage(delta) {
    cancelRecentStatus(); recentPage += delta; renderRecents();
    if (recentButtons[0]) recentButtons[0].focus();
    refreshRecentStatus();
  }
  el('recent-previous').addEventListener('click', function () { turnRecentPage(-1); });
  el('recent-next').addEventListener('click', function () { turnRecentPage(1); });
  el('catalog-retry').addEventListener('click', function () { startChannel(input.value, false); });
  function turnPage(delta) { page += delta; renderVideos(); if (videoButtons[0]) videoButtons[0].focus(); }
  el('previous-page').addEventListener('click', function () { turnPage(-1); });
  el('next-page').addEventListener('click', function () { turnPage(1); });
  el('back').addEventListener('click', goHome);
  el('live').addEventListener('click', function () { if (catalog) startVideo(catalog.live); });
  el('watch-recordings').addEventListener('click', showCatalog);
  el('toggle').addEventListener('click', toggle);
  el('reconnect').addEventListener('click', function () { if (!preparing && current) player.reconnect(false); showControls(); });
  el('seek').addEventListener('input', function () { scrubbing = true; updateTimeline(); showControls(); });
  el('seek').addEventListener('change', function () {
    player.seekTo(Number(el('seek').value));
    scrubbing = false;
    updateTimeline();
    showControls();
  });
  el('seek').addEventListener('blur', function () { scrubbing = false; if (!hidingControls) showControls(); });
  el('watch').addEventListener('mousemove',function(event){
    if(!event||typeof event.clientX!=='number'||typeof event.clientY!=='number')return;
    if(pointerX===null||Math.abs(event.clientX-pointerX)+Math.abs(event.clientY-pointerY)>12){pointerX=event.clientX;pointerY=event.clientY;showControls();}
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      speedEpoch++;openingSpeed=false;closeSpeed();if(runtime&&!runtime.browser)runtime.cancelOpen(true);
      if (browse) browse.setVisible(false);
      cancelHomeLayout(); cancelCatalogLayout();
      cancelRecentStatus(); cancelContinue(); closeAccessibility(false); closeJump(false); closeSearch(false, false); closeQuality(); closeFavoriteMove(false); closeResume(false);
      var interrupted = !!request;
      cancelRequest();
      if (screen === 'about') { el('check-updates').disabled = false; el('update-status').textContent = t('update_unavailable'); }
      preparing = false;
      el('toggle').disabled = false;
      clearTimeout(controlsTimer);
      if (current) player.suspend();
      else if (interrupted && screen === 'catalog') {
        el('channel-status').textContent = t('lookup_interrupted', { retry: t('retry') });
        el('catalog-retry').hidden = false;
      }
      saveWatched();if(runtime&&runtime.browser)runtime.hidden();
    } else if (current) { collectAccelerated();showControls(); el('toggle').focus(); }
    else if (screen === 'home') { collectAccelerated();if (browse) browse.setVisible(true); if (!browse || browse.mode()==='library') {renderContinue(); refreshRecentStatus();} }
    else if (screen === 'catalog') { fitCatalog(); (videoButtons[0] || el('catalog-back')).focus(); }
  });
  window.addEventListener('pagehide', function () { if(browse) browse.setVisible(false); cancelContinue(); closeAccessibility(false); closeJump(false); closeSearch(false, false); closeQuality(); closeFavoriteMove(false); closeResume(false); cancelRecentStatus(); cancelRequest(); player.suspend(); saveWatched();if(runtime&&runtime.browser)runtime.hidden();speedEpoch++;openingSpeed=false;closeSpeed();cancelHomeLayout(); cancelCatalogLayout(); });
  window.addEventListener('resize', function () { fitHome(); fitCatalog(); });
  window.addEventListener('offline', function () { if (screen === 'watch') player.offline(); });
  window.addEventListener('online', function () { if (screen === 'watch' && !document.hidden) player.online(); if (screen === 'home' && !document.hidden) { if(browse)browse.refresh(); if(!browse||browse.mode()==='library'){renderContinue();refreshRecentStatus();} } });
  document.addEventListener('keydown', function (event) {
    var key = event.keyCode;
    // Transport commands remain active while a playback dialog owns navigation focus.
    if (screen === 'watch' && (key === 19 || key === 415 || key === 179)) {
      event.preventDefault();
      if (preparing) return;
      if (key === 19) player.pause();
      else if (key === 415) { if (playback.phase === 'idle' && current) toggle(); else player.play(); }
      else toggle();
      showControls(); return;
    }
    if (accessibilityOpen) {
      var settings = ['text-size', 'high-contrast', 'accessibility-reset', 'accessibility-close'].map(el);
      if (key === 461 || key === 27) { event.preventDefault(); closeAccessibility(true); }
      else if (key === 9 || key >= 37 && key <= 40) {
        event.preventDefault(); var ai = settings.indexOf(event.target), ad = key === 9 ? event.shiftKey ? -1 : 1 : key === 37 || key === 38 ? -1 : 1;
        var at = settings[(Math.max(0, ai) + ad + settings.length) % settings.length]; at.focus(); at.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (jumpOpen) {
      if (key === 461 || key === 27) { event.preventDefault(); closeJump(true); }
      else if (key === 412 || key === 417) { event.preventDefault(); jumpStep(key === 412 ? -600 : 600); }
      else if (key === 9 || key >= 37 && key <= 40) {
        var jumpControls = ['jump-hours', 'jump-minutes', 'jump-seconds', 'jump-back', 'jump-forward', 'jump-confirm', 'jump-cancel'].map(el).filter(function (control) { return !control.disabled; });
        if (jumpControls.indexOf(event.target) < 3 && (key === 37 || key === 39)) return;
        event.preventDefault(); var ji = jumpControls.indexOf(event.target), jd = key === 9 ? event.shiftKey ? -1 : 1 : key === 37 || key === 38 ? -1 : 1;
        var jt = jumpControls[(Math.max(0, ji) + jd + jumpControls.length) % jumpControls.length]; jt.focus(); jt.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (!el('saved-search').hidden || toolsSnapshot) {
      var savedOpen = !el('saved-search').hidden, searchInput = el(savedOpen ? 'saved-query' : 'replay-query');
      var searchControls = savedOpen ? [searchInput, el('saved-clear')].concat(savedSearchButtons, [el('saved-previous'), el('saved-next'), el('saved-cancel')]) :
        [searchInput, el('replay-filter'), el('replay-sort'), el('replay-reset'), el('replay-apply'), el('replay-cancel')];
      searchControls = searchControls.filter(function (button) { return !button.disabled; });
      if (key === 461 || key === 27) { event.preventDefault(); closeSearch(false, true); }
      else if (key === 9 || key >= 37 && key <= 40) {
        if (event.target === searchInput && (key === 37 || key === 39)) return;
        event.preventDefault(); var searchIndex = searchControls.indexOf(event.target), searchDirection = key === 9 ? event.shiftKey ? -1 : 1 : key === 37 || key === 38 ? -1 : 1;
        var searchTarget = searchControls[(Math.max(0, searchIndex) + searchDirection + searchControls.length) % searchControls.length];
        searchTarget.focus(); searchTarget.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if(!el('speed-choice').hidden){
      if(key===461||key===27){event.preventDefault();closeSpeed();showControls();el('speed-button').focus();}
      else if(key===9||key>=37&&key<=40){event.preventDefault();var si=speedButtons.indexOf(event.target),sd=key===9?(event.shiftKey?-1:1):(key===37||key===38?-1:1);speedButtons[(Math.max(0,si)+sd+speedButtons.length)%speedButtons.length].focus();}
      return;
    }
    if (!el('quality-choice').hidden) {
      if (key === 461 || key === 27) { event.preventDefault(); closeQuality(); showControls(); el('quality-button').focus(); }
      else if (key === 9 || key >= 37 && key <= 40) {
        event.preventDefault(); var qualityIndex = qualityButtons.indexOf(event.target), direction = key === 9 ? event.shiftKey ? -1 : 1 : key === 37 || key === 38 ? -1 : 1;
        var qualityTarget = qualityButtons[(Math.max(0, qualityIndex) + direction + qualityButtons.length) % qualityButtons.length];
        qualityTarget.focus(); qualityTarget.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (favoriteMove) {
      var moveControls = [el('favorite-move-up'), el('favorite-move-down'), el('favorite-move-save'), el('favorite-move-cancel')].filter(function (control) { return !control.disabled; });
      if (key === 461 || key === 27) { event.preventDefault(); closeFavoriteMove(false); }
      else if (key === 9 || key >= 37 && key <= 40) {
        event.preventDefault(); var at = moveControls.indexOf(event.target), step = key === 9 ? event.shiftKey ? -1 : 1 : key === 37 || key === 38 ? -1 : 1;
        moveControls[(Math.max(0, at) + step + moveControls.length) % moveControls.length].focus();
      }
      return;
    }
    if (resumeItem) {
      var choices = [el('resume-continue'), el('resume-start'), el('resume-cancel')];
      if (key === 9) {
        event.preventDefault(); var choice = choices.indexOf(event.target);
        if (choice < 0) choice = event.shiftKey ? 0 : -1;
        choices[(choice + (event.shiftKey ? -1 : 1) + 3) % 3].focus();
      } else if (key === 461 || key === 27) { event.preventDefault(); closeResume(true); }
      else if (key >= 37 && key <= 40) {
        event.preventDefault();
        choices[Math.max(0, Math.min(2, choices.indexOf(event.target) + (key === 37 || key === 38 ? -1 : 1)))].focus();
      }
      return;
    }
    if (screen === 'home' && browse && browse.key(event)) return;
    if (screen === 'home' && browse && event.target === input && key === 38) { event.preventDefault(); browse.tabs[3].focus(); return; }
    if (key === 461 || key === 27) {
      event.preventDefault();
      if (screen === 'watch') {if(!el('playback-controls').hidden)hideControls();else showCatalog();}
      else if (screen === 'catalog') goHome();
      else if (screen === 'about') closeAbout();
      else if (typeof webOSSystem !== 'undefined') webOSSystem.platformBack();
      return;
    }
    if (screen === 'watch') {
      if ((key === 37 || key === 39) && current && !current.isLive &&
        (event.target === el('watch') || event.target === el('seek'))) {
        event.preventDefault();
        scrubbing = false;
        seek(key === 37 ? -10 : 10);
        updateTimeline();
        el('seek').focus();
        return;
      }
      if (key === 13 && (event.target === el('watch') || event.target === el('seek'))) {
        event.preventDefault();
        if(el('playback-controls').hidden){showControls();el('toggle').focus();}
        else hideControls();
        return;
      }
      if(key===457){event.preventDefault();if(el('playback-controls').hidden){showControls();el('toggle').focus();}else hideControls();return;}
      if (key === 412 || key === 417) { event.preventDefault(); openJump(key === 412 ? -600 : 600); return; }
      if (key >= 37 && key <= 40) showControls();
    }
    var controls = screen === 'home' ? [input, el('favorite-channel'), el('play'), el('recordings'), el('find-saved')].concat(recentControls,
      el('recent-pages').hidden ? [] : [el('recent-previous'), el('recent-next')], favoriteControls, el('favorite-pages').hidden ? [] : [el('favorite-previous'), el('favorite-next')], continueControls,
      el('continue-pages').hidden ? [] : [el('continue-previous'), el('continue-next')], [el('about-button'), el('accessibility-button')]) :
      screen === 'catalog' ? [el('catalog-search')].concat(el('live').hidden ? [] : [el('live')], videoButtons,
        el('catalog-retry').hidden ? [] : [el('catalog-retry')],
        el('pages').hidden ? [] : [el('previous-page'), el('next-page')].filter(function (b) { return !b.disabled; }), [el('catalog-back'), el('catalog-favorite')]) :
      screen === 'about' ? [el('check-updates'), el('about-back')] : (current && current.isLive ? [] : [el('seek'), el('jump-time')]).concat([el('toggle'), el('reconnect'), el('quality-button'), el('speed-button'), el('hide-controls'), el('watch-recordings'), el('back')]);
    controls = controls.filter(function (control) { return !control.disabled && !control.hidden; });
    var index = controls.indexOf(event.target);
    if (screen === 'home' && (key === 37 || key === 39)) {
      var groups = [recentControls, favoriteControls, continueControls], strides = [3, 3, 2];
      for (var g = 0; g < groups.length; g++) {
        var cell = groups[g].indexOf(event.target), step = key === 37 ? -1 : 1;
        if (cell < 0 || cell % strides[g] !== (step < 0 ? 0 : strides[g] - 1)) continue;
        event.preventDefault();
        var neighbor = g + step;
        while (neighbor >= 0 && neighbor < groups.length && !groups[neighbor].length) neighbor += step;
        if (neighbor >= 0 && neighbor < groups.length) {
          var row = Math.min(Math.floor(cell / strides[g]), groups[neighbor].length / strides[neighbor] - 1);
          groups[neighbor][row * strides[neighbor] + (step < 0 ? strides[neighbor] - 1 : 0)].focus();
        }
        return;
      }
    }
    if (screen === 'home' && (key === 38 || key === 40)) {
      var paging = [['recent-previous', 'recent-next'], ['favorite-previous', 'favorite-next'], ['continue-previous', 'continue-next']];
      for (var p = 0; p < paging.length; p++) if (paging[p].indexOf(event.target.id) >= 0) {
        event.preventDefault(); var group = [recentControls, favoriteControls, continueControls][p], stride = p === 2 ? 2 : 3;
        (key === 38 ? group[Math.max(0, group.length - stride)] || el('recordings') : el('about-button')).focus(); return;
      }
      if (key === 38 && (event.target === el('about-button') || event.target === el('accessibility-button'))) {
        event.preventDefault();
        var bottom = favoriteControls.length ? favoriteControls[favoriteControls.length - 3] : recentControls.length ? recentControls[recentControls.length - 3] : continueControls[continueControls.length - 2];
        (bottom || el('recordings')).focus(); return;
      }
    }
    var recentIndex = recentControls.indexOf(event.target);
    if (screen === 'home' && recentIndex >= 0 && (key === 38 || key === 40)) {
      event.preventDefault();
      var rowTarget = recentIndex + (key === 38 ? -3 : 3);
      var recentControl = rowTarget < 0 ? el('recordings') : recentControls[rowTarget] ||
        (!el('recent-next').disabled ? el('recent-next') : !el('recent-previous').disabled ? el('recent-previous') : el('about-button'));
      recentControl.focus(); recentControl.scrollIntoView({ block: 'nearest' });
      return;
    }
    var favoriteIndex = favoriteControls.indexOf(event.target);
    if (screen === 'home' && favoriteIndex >= 0 && (key === 38 || key === 40)) {
      event.preventDefault(); var favoriteTarget = favoriteIndex + (key === 38 ? -1 : 1) * 3;
      var favoriteControl = favoriteTarget < 0 ? el('recordings') :
        favoriteControls[favoriteTarget] || (!el('favorite-next').disabled ? el('favorite-next') : !el('favorite-previous').disabled ? el('favorite-previous') : el('about-button'));
      favoriteControl.focus(); favoriteControl.scrollIntoView({ block: 'nearest' }); return;
    }
    var continueIndex = continueControls.indexOf(event.target);
    if (screen === 'home' && continueIndex >= 0 && (key === 38 || key === 40)) {
      event.preventDefault();
      var shelfTarget = continueIndex + (key === 38 ? -1 : 1) * 2;
      var shelfControl = shelfTarget < 0 ? el('recordings') :
        continueControls[shelfTarget] || (!el('continue-next').disabled ? el('continue-next') : !el('continue-previous').disabled ? el('continue-previous') : el('about-button'));
      shelfControl.focus(); shelfControl.scrollIntoView({ block: 'nearest' }); return;
    }
    var cardIndex = videoButtons.indexOf(event.target);
    if (screen === 'catalog' && cardIndex >= 0 && (key === 38 || key === 40)) {
      event.preventDefault();
      var columns = window.innerWidth <= 560 ? 1 : accessibility.size === 'large' || window.innerWidth <= 800 ? 2 : 3;
      var card = cardIndex + (key === 38 ? -columns : columns);
      var target = card < 0 ? (el('live').hidden ? el('catalog-back') : el('live')) :
        card >= videoButtons.length ? (!el('pages').hidden && !el('next-page').disabled ? el('next-page') : el('catalog-back')) : videoButtons[card];
      target.focus(); target.scrollIntoView({ block: 'nearest' }); return;
    }
    if (key >= 37 && key <= 40) {
      if (event.target === input && (key === 37 || key === 39)) return;
      event.preventDefault();
      var next = index < 0 ? 0 : Math.max(0, Math.min(controls.length - 1, index + (key === 37 || key === 38 ? -1 : 1)));
      if (!controls[next]) return;
      controls[next].focus();
      if (screen === 'catalog' || screen === 'home') controls[next].scrollIntoView({ block: 'nearest' });
    }
  });
  function hydrateStorage(){
    watched=[];recents=[];favorites=[];
  try {
    var rawHistory = localStorage.getItem('kick-watched-videos') || '[]';
    var savedHistory = rawHistory.length <= 100000 ? JSON.parse(rawHistory) : [];
    if (Array.isArray(savedHistory)) savedHistory.slice(0, 200).forEach(function (entry) {
      if (!entry || typeof entry.key !== 'string' || !/^[a-z0-9_-]{1,25}:[a-z0-9-]{1,64}$/.test(entry.key) ||
        typeof entry.position !== 'number' || !isFinite(entry.position) || entry.position <= 0 || entry.position > 2592000 ||
        typeof entry.duration !== 'number' || !isFinite(entry.duration) || entry.duration < 0 || entry.duration > 2592000 ||
        typeof entry.finished !== 'boolean' || watched.some(function (other) { return other.key === entry.key; })) return;
      watched.push({ key: entry.key, position: entry.position, duration: entry.duration, finished: entry.finished });
    });
  } catch (e) { /* Ignore corrupt or unavailable replay history. */ }
  try {
    var rawRecent = localStorage.getItem('kick-recent-channels') || '[]';
    var saved = rawRecent.length <= 2048 ? JSON.parse(rawRecent) : [];
    if (Array.isArray(saved)) saved.forEach(function (value) {
      var name = kickChannel(value);
      if (name && recents.indexOf(name) === -1 && recents.length < 50) recents.push(name);
    });
  } catch (e) { /* Ignore corrupt or unavailable storage. */ }
  if (!recents.length) {
    try { var last = kickChannel(localStorage.getItem('kick-channel')); if (last) recents.push(last); }
    catch (e) { /* Optional migration. */ }
  }
  try {
    var rawFavorites = localStorage.getItem('kick-favorites') || '[]';
    var savedFavorites = rawFavorites.length <= 4096 ? JSON.parse(rawFavorites) : [];
    if (Array.isArray(savedFavorites)) savedFavorites.slice(0, 100).forEach(function (value) {
      var name = kickChannel(value);
      if (name && favorites.indexOf(name) === -1 && favorites.length < 50) favorites.push(name);
    });
  } catch (e) { /* Ignore corrupt or unavailable favorite storage. */ }
  try { var savedQuality = localStorage.getItem('kick-quality-preference'); if (/^(?:auto|[1-9][0-9]{0,3})$/.test(savedQuality) && (savedQuality === 'auto' || +savedQuality <= 2160)) qualityPreference = savedQuality; } catch (e) { /* Auto default. */ }
  try { var rawRelease = localStorage.getItem('kick-release-cache') || ''; if (rawRelease.length <= 8192) { var savedRelease = JSON.parse(rawRelease); if (validRelease(savedRelease)) releaseCache = savedRelease; } } catch (e) { /* Ignore invalid update cache. */ }
  try { var savedRetry = localStorage.getItem('kick-update-retry-at'); if (/^[0-9]{1,13}$/.test(savedRetry) && +savedRetry > Date.now() && +savedRetry <= 4102444800000) updateRetryAt = +savedRetry; } catch (e) { /* Session-only backoff. */ }
  try { var rawAccessibility = localStorage.getItem('kick-accessibility') || ''; if (rawAccessibility.length <= 256) { var savedAccessibility = JSON.parse(rawAccessibility); if (savedAccessibility && (savedAccessibility.size === 'normal' || savedAccessibility.size === 'large') && typeof savedAccessibility.contrast === 'boolean') accessibility = { size: savedAccessibility.size, contrast: savedAccessibility.contrast }; } } catch (e) { /* Use readable defaults. */ }
  applyAccessibility(false);

    try{var rate=Number(localStorage.getItem('kick-speed-preference'));if([1,1.25,1.5,1.75,2].indexOf(rate)>=0)speedPreference=rate;}catch(e){}
  }
  hydrateStorage();
  input.value = recents[0] || '';
  renderRecents(); renderFavorites();
  if (typeof KickBrowse === 'function') browse = KickBrowse({ language:t.language, favorites:function(){return favorites.slice();},
    favorite:toggleNamedFavorite, open:function(name){startChannel(name,true);}, libraryFocus:function(){return input;},
    mode:function(name){ cancelRecentStatus(); cancelContinue(); if(name==='library'){renderContinue();refreshRecentStatus();fitHome();} }
  });
  setScreen('home');
  if (browse) browse.focus(); else (recentButtons[0] || input).focus();
  if(runtime&&runtime.browser&&runtime.initial)runtime.whenReady(function(){startChannel(runtime.initial.channel,false,runtime.initial.video);});
  else collectAccelerated();
}());
