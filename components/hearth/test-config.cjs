'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'overlay');
const defaults = fs.readFileSync(path.join(root, 'defaults.js'), 'utf8');
let value = null;
const context = {window: {localStorage: {
  getItem() { return value; }, setItem(key, next) { value = next; }
}}};
vm.runInNewContext(defaults, context);
const preset = JSON.parse(value);
assert.equal(preset.weather.city, null);
assert.equal(preset.weather.on, false);
assert.deepEqual(preset.appIds, []);
assert.deepEqual(preset, JSON.parse(fs.readFileSync(path.join(__dirname, '../../settings/hearth.example.json'), 'utf8')));
value = JSON.stringify({clockFormat: '12h', weather: {on: false, city: {name: 'Custom', lat: 0, lon: 0}}});
const previous = value;
vm.runInNewContext(defaults, context);
assert.equal(value, previous, 'Existing user settings must not be changed');
const scenery = require(path.join(root, 'dashboard/scenery-model.js'));
for (const [hour, phase] of [[0, 'night'], [6, 'dawn'], [12, 'day'], [20, 'evening'], [23, 'night']]) {
  const state = scenery.state(new Date(2024, 0, 15, hour));
  assert.equal(state.phase, phase);
  assert.equal(state.altitudeDegrees, null);
  assert(fs.existsSync(path.join(root, 'dashboard', state.asset)));
}
assert.equal(scenery.season(new Date(2024, 0, 15), {lat: -1, lon: 0}), 'summer');
const modelCode = fs.readFileSync(path.join(root, 'dashboard/scenery-model.js'), 'utf8');
let coordinates = null;
const browser = {window: {SunCalc: {getPosition(date, lat, lon) {
  coordinates = [lat, lon]; return {altitude: 1, azimuth: 0};
}}}};
vm.runInNewContext(modelCode, browser);
assert.equal(browser.window.__hearthScenery.state(new Date(), {lat: 0, lon: 1}).phase, 'day');
assert.deepEqual(coordinates, [0, 1]);
console.log('PASS: anonymous defaults, preservation of preferences, local-clock fallback and configured solar coordinates');
