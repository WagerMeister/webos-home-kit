/* MET Norway forecast adapter for Hearth. CC BY 4.0 data.
 * https://api.met.no/ — weather symbols mapped to Hearth's existing WMO categories. */
(function (root) {
  'use strict';
  function codeFor(symbol) {
    if (/thunder/.test(symbol)) return 95;
    if (/snow/.test(symbol)) return /heavy/.test(symbol) ? 75 : /light/.test(symbol) ? 71 : 73;
    if (/sleet/.test(symbol)) return 73;
    if (/rain/.test(symbol)) return /heavy/.test(symbol) ? 65 : /light/.test(symbol) ? 61 : 63;
    if (/fog/.test(symbol)) return 45;
    if (/clearsky/.test(symbol)) return 0;
    if (/fair/.test(symbol)) return 1;
    if (/partlycloudy/.test(symbol)) return 2;
    return 3;
  }
  function parse(text, city, now) {
    var data = JSON.parse(text);
    var series = data && data.properties && data.properties.timeseries;
    if (!Array.isArray(series) || !series.length) throw new Error('Weather forecast is empty');
    var nearest = null;
    var distance = Infinity;
    series.forEach(function (entry) {
      var stamp = Date.parse(entry.time);
      var temp = entry.data && entry.data.instant && entry.data.instant.details && entry.data.instant.details.air_temperature;
      if (!isFinite(stamp) || typeof temp !== 'number' || !isFinite(temp)) return;
      if (Math.abs(stamp - now) < distance) { nearest = entry; distance = Math.abs(stamp - now); }
    });
    if (!nearest || distance > 6 * 60 * 60 * 1000) throw new Error('Weather forecast is outdated');
    var interval = nearest.data.next_1_hours || nearest.data.next_6_hours || nearest.data.next_12_hours;
    var symbol = interval && interval.summary && interval.summary.symbol_code || 'cloudy';
    return {lat: city.lat, lon: city.lon, tempC: nearest.data.instant.details.air_temperature,
      // This forward-only forecast cannot establish complete local-day extrema.
      highC: null, lowC: null,
      code: codeFor(symbol), isDay: !/_night$/.test(symbol), at: now};
  }
  function requestWeather(city) {
    return new Promise(function (resolve, reject) {
      if (!city || typeof city.lat !== 'number' || typeof city.lon !== 'number' || !isFinite(city.lat) || !isFinite(city.lon) || Math.abs(city.lat) > 90 || Math.abs(city.lon) > 180) {
        reject(new Error('Invalid weather coordinates')); return;
      }
      var Bridge = root.PalmServiceBridge;
      if (!Bridge) { reject(new Error('Weather requires the TV service')); return; }
      var bridge = new Bridge();
      var settled = false;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        try { if (bridge.cancel) bridge.cancel(); } catch (ignore) {}
        if (error) reject(error); else resolve(result);
      }
      var timer = root.setTimeout(function () { finish(new Error('Weather service timed out')); }, 18000);
      bridge.onservicecallback = function (message) {
        try {
          var result = JSON.parse(message);
          if (result.returnValue !== true || typeof result.stdoutString !== 'string') throw new Error('Weather fetch failed');
          var now = Date.now();
          var current = parse(result.stdoutString, city, now);
          try {
            var preferences = JSON.parse(root.localStorage.getItem('customlauncher-config-v1') || 'null');
            var selected = preferences && preferences.weather && preferences.weather.city;
            if (root.__HearthForecastModel && selected && selected.lat === city.lat && selected.lon === city.lon) {
              var forecast = {version: 2, lat: city.lat, lon: city.lon, city: city.name, at: now, source: JSON.parse(result.stdoutString)};
              root.localStorage.setItem('hearth-dashboard-forecast-v1', JSON.stringify(forecast));
              var event = root.document.createEvent('Event');
              event.initEvent('hearth:forecast', false, false);
              root.dispatchEvent(event);
            }
          } catch (forecastError) { /* Native current weather still works if the extra cache is unavailable. */ }
          finish(null, current);
        } catch (error) { finish(error); }
      };
      var command = '/usr/bin/python /var/lib/webosbrew/hearth-boot-audio/weather-provider.py ' + city.lat.toFixed(4) + ' ' + city.lon.toFixed(4);
      try { bridge.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({command: command})); }
      catch (error) { finish(error); }
    });
  }
  var pending = null;
  var pendingKey = '';
  function fetchWeather(city) {
    var key = city && String(city.lat) + ',' + String(city.lon);
    if (pending && pendingKey === key) return pending;
    var request = requestWeather(city);
    pendingKey = key;
    pending = request;
    function clear() { if (pending === request) { pending = null; pendingKey = ''; } }
    request.then(clear, clear);
    return request;
  }
  root.__hearthMetWeather = {fetch: fetchWeather, parse: parse, codeFor: codeFor};
}(typeof window !== 'undefined' ? window : global));
