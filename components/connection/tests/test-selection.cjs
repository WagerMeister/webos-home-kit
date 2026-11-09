'use strict';
const assert = require('node:assert/strict');
const {create} = require('../root/manager');
const registry = require('../root/providers');
assert.equal(typeof registry.get('tailscale').available, 'function', 'Discovery must be exported on the actual adapter');
const files = new Map(), root = '/private/connection-test';
const config = {version: 1, enabled: false, provider: 'first', providerConfig: {profile: 'one'},
  profiles: {second: {profile: 'two'}, absent: {profile: 'missing'}}};
let now = 1700000000000;
const lives = {};
const definitions = ['first', 'second', 'absent', 'unconfigured'].map(id => ({
  id, label: id, capabilities: {}, available: () => id !== 'absent',
  create(context) {
    const life = {raw: {state: 'off', connected: false, quiescent: true}, closed: 0, started: 0, settings: context.settings};
    lives[id] = life;
    return {start() { life.started++; }, close() { life.closed++; },
      status() { return life.raw; }, request(action) { life.raw = {state: 'disconnecting', quiescent: false}; }};
  }
}));
const io = {readFileSync(p) { if (files.has(p)) return files.get(p); const e = Error(); e.code = 'ENOENT'; throw e; },
  writeFileSync(p, v) { files.set(p, v); }, renameSync(a, b) { files.set(b, files.get(a)); files.delete(a); }};
const controller = create({root, config, fs: io, now: () => now,
  getProvider: id => definitions.find(x => x.id === id), listProviders: () => definitions});
function send(action, provider) { return controller.dispatch({action, provider, issued: now++}); }
assert.deepEqual(send('providers').providers.map(x => x.id), ['first', 'second']);
assert.equal(send('select', '../../module').error, 'provider_unavailable');
assert.equal(send('select', 'absent').error, 'provider_unavailable');
send('on');
assert.equal(send('select', 'second').error, 'disconnect_first');
send('off');
assert.equal(send('select', 'second').error, 'disconnect_first', 'off intent is not proof of restored routing');
lives.first.raw = {state: 'off', quiescent: true, busy: false};
const selected = send('select', 'second');
assert.equal(selected.provider, 'second');
assert.equal(selected.wanted, false);
assert.equal(lives.first.closed, 1);
assert.equal(lives.second.started, 1);
assert.deepEqual(lives.second.settings, {profile: 'two'});
assert.deepEqual(config.profiles.first, {profile: 'one'});
assert.equal(JSON.parse(files.get(root + '/config.json')).provider, 'second');
assert.equal(send('providers').providers.find(x => x.id === 'second').selected, true);
console.log('PASS: registered/installed/configured engine discovery, unavailable rejection, off+quiescent switch gate, profile persistence and lifecycle');
