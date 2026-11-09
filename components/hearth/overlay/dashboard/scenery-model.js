/* Offline seasonal scenery. SunCalc 1.9.0 (BSD-2-Clause) supplies solar position. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./suncalc.js'));
  else root.__hearthScenery = factory(root.SunCalc);
}(typeof window !== 'undefined' ? window : this, function (solar) {
  'use strict';
  function hasLocation(location) {
    return !!(location && typeof location.lat === 'number' && isFinite(location.lat) &&
      Math.abs(location.lat) <= 90 && typeof location.lon === 'number' &&
      isFinite(location.lon) && Math.abs(location.lon) <= 180);
  }
  function season(date, location, preferences) {
    var months = preferences && preferences.seasonByMonth;
    if (Array.isArray(months) && months.length === 12 && months.every(function(value) {
      return ["winter", "spring", "summer", "autumn"].indexOf(value) >= 0;
    })) return months[date.getMonth()];
    var month = date.getMonth() + 1;
    if (hasLocation(location) && location.lat < 0) month = (month + 5) % 12 + 1;
    if (month <= 2 || month === 12) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
  }
  function state(date, location, preferences) {
    if (!date || !isFinite(date.getTime())) throw new Error('Invalid scenery date');
    var hour = date.getHours();
    var phase = hour < 6 || hour >= 23 ? 'night' : hour < 10 ? 'dawn' : hour < 18 ? 'day' : 'evening';
    var height = null;
    if (hasLocation(location) && solar && typeof solar.getPosition === 'function') {
      var position = solar.getPosition(date, location.lat, location.lon);
      height = position.altitude * 180 / Math.PI;
      if (!isFinite(height) || !isFinite(position.azimuth)) throw new Error('Invalid solar position');
    // Civil twilight (-6 degrees) bounds the lit sky; +6 degrees bounds
    // the photographic golden hour. Azimuth distinguishes morning/evening.
      phase = height < -6 ? 'night' : height >= 6 ? 'day' : position.azimuth < 0 ? 'dawn' : 'evening';
    }
    var currentSeason = season(date, location, preferences);
    return {season: currentSeason, phase: phase, altitudeDegrees: height,
      asset: 'scenes/' + currentSeason + '/' + phase + '.jpg'};
  }
  return {state: state, season: season};
}));
