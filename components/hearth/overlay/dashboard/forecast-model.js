/* Forecast data: MET Norway Locationforecast, CC BY 4.0; adapted into local-day cards. */
(function (root) {
  'use strict';
  var HOUR = 3600000;
  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function dayKey(date) { return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate(); }
  function phase(hour) {
    if (hour >= 6 && hour < 10) return 'dawn';
    if (hour >= 10 && hour < 18) return 'day';
    if (hour >= 18 && hour < 23) return 'evening';
    return 'night';
  }
  function calendar(date) {
    var first = new Date(date.getFullYear(), date.getMonth(), 1);
    var offset = (first.getDay() + 6) % 7;
    var count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    var cells = [];
    var total = Math.ceil((offset + count) / 7) * 7;
    for (var i = 0; i < total; i += 1) cells.push(i < offset || i >= offset + count ? 0 : i - offset + 1);
    return {year: date.getFullYear(), month: date.getMonth(), today: date.getDate(), cells: cells};
  }
  function interval(entry) {
    var data = entry.data || {};
    var options = [['next_1_hours', 1], ['next_6_hours', 6], ['next_12_hours', 12]];
    for (var i = 0; i < options.length; i += 1) {
      var item = data[options[i][0]];
      if (item && item.details && finite(item.details.precipitation_amount) && item.details.precipitation_amount >= 0) {
        return {hours: options[i][1], rain: item.details.precipitation_amount};
      }
    }
    return null;
  }
  function symbol(entry) {
    var data = entry.data || {};
    var next = data.next_1_hours || data.next_6_hours || data.next_12_hours;
    return next && next.summary && typeof next.summary.symbol_code === 'string' ? next.summary.symbol_code : 'cloudy';
  }
  function forecast(text, city, now) {
    var json = typeof text === 'string' ? JSON.parse(text) : text;
    var series = json && json.properties && json.properties.timeseries;
    if (!Array.isArray(series) || !series.length || !city || !finite(city.lat) || !finite(city.lon)) throw new Error('Invalid forecast');
    var entries = [];
    series.forEach(function (entry) {
      var at = Date.parse(entry.time);
      var details = entry.data && entry.data.instant && entry.data.instant.details;
      if (finite(at) && details && finite(details.air_temperature)) entries.push({at: at, item: entry, details: details});
    });
    entries.sort(function (a, b) { return a.at - b.at; });
    if (!entries.length || entries[entries.length - 1].at < now - HOUR) throw new Error('Outdated forecast');
    var current = new Date(now);
    var days = [];
    for (var index = 0; index < 3; index += 1) {
      var start = new Date(current.getFullYear(), current.getMonth(), current.getDate() + index).getTime();
      var end = new Date(current.getFullYear(), current.getMonth(), current.getDate() + index + 1).getTime();
      // Today explicitly covers the remaining forecast, not historical daily extrema.
      var from = index === 0 ? Math.max(start, now) : start;
      var target = new Date(current.getFullYear(), current.getMonth(), current.getDate() + index, 12).getTime();
      if (index === 0) target = Math.max(target, now);
      var nearest = null;
      var distance = Infinity;
      var rain = 0;
      var covered = 0;
      var cursor = from;
      entries.forEach(function (entry) {
        if (entry.at >= Math.floor(from / HOUR) * HOUR && entry.at < end && Math.abs(entry.at - target) < distance) {
          nearest = entry; distance = Math.abs(entry.at - target);
        }
        var amount = interval(entry.item);
        if (!amount || entry.at >= end) return;
        var until = entry.at + amount.hours * HOUR;
        var overlap = Math.max(0, Math.min(end, until) - Math.max(entry.at, from, cursor));
        if (overlap) {
          rain += amount.rain * overlap / (amount.hours * HOUR);
          covered += overlap;
          cursor = until;
        }
      });
      if (!nearest || distance > 6 * HOUR) { days.push(null); continue; }
      var stamp = new Date(nearest.at);
      days.push({key: dayKey(new Date(start)), at: nearest.at, hour: stamp.getHours(),
        tempC: nearest.details.air_temperature,
        windMS: finite(nearest.details.wind_speed) ? nearest.details.wind_speed : null,
        precipitationMM: covered >= (end - from) * 0.9 ? Math.round(rain * 10) / 10 : null,
        symbol: symbol(nearest.item), partialToday: index === 0});
    }
    return {version: 1, lat: city.lat, lon: city.lon, city: city.name, at: now, day: dayKey(current), days: days};
  }
  function usable(data, city, now) {
    return !!(data && data.version === 1 && city && data.lat === city.lat && data.lon === city.lon &&
      finite(data.at) && now >= data.at && now - data.at < 6 * HOUR && data.day === dayKey(new Date(now)) && Array.isArray(data.days) && data.days.length === 3 &&
      data.days.every(function (day) { return day === null || day && finite(day.tempC) && finite(day.hour) && day.hour >= 0 && day.hour <= 23 &&
        (day.windMS === null || finite(day.windMS)) && (day.precipitationMM === null || finite(day.precipitationMM)) && typeof day.symbol === 'string'; }));
  }
  function sourceUsable(data, city, now) {
    return !!(data && data.version === 2 && city && data.lat === city.lat && data.lon === city.lon && finite(data.at) &&
      now >= data.at && now - data.at < 6 * HOUR && data.source && data.source.properties && Array.isArray(data.source.properties.timeseries));
  }
  var api = {phase: phase, calendar: calendar, forecast: forecast, usable: usable, sourceUsable: sourceUsable, dayKey: dayKey};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__HearthForecastModel = api;
}(typeof window !== 'undefined' ? window : this));
