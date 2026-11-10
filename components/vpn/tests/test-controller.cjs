'use strict';
const assert = require('node:assert/strict');
const {create} = require('../root/manager');
const registry = require('../root/providers');
const example = require('../config.example.json');

function fixture(provider = 'tailscale', owner) {
  const files = new Map(), requests = [];
  let now = 1700000000000;
  const root = '/private/test-connection';
  if (owner) files.set(root + '/state/provider.json', JSON.stringify(owner));
  const config = {...example, enabled: false, provider};
  let raw = {state: 'off', connected: false, authenticated: true, quiescent: true};
  let started = 0, closed = 0, context;
  const definition = {id: provider, label: 'Test transport', capabilities: {browserLogin: provider === 'tailscale'},
    validateAuthURL: value => value === 'https://login.example.invalid/EXAMPLE',
    create(options) {
      context = options;
      return {
        start() { started++; }, close() { closed++; },
        request(action) {
          requests.push(action);
          raw = {state: action === 'off' ? 'disconnecting' : 'connecting', connected: false,
            authenticated: true, quiescent: false};
        },
        status() { return raw; }
      };
    }};
  const io = {
    readFileSync(name) { if (files.has(name)) return files.get(name); const e = Error('missing'); e.code = 'ENOENT'; throw e; },
    writeFileSync(name, data) { files.set(name, data); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
  };
  const controller = create({root, config, fs: io, now: () => now, getProvider: () => definition});
  return {controller, config, files, requests, root, get context() { return context; },
    status(value) { raw = value; }, time(value) { now = value; },
    send(action, issued = now) { return controller.dispatch({action, issued}); },
    lifecycle() { return {started, closed}; }};
}

const f = fixture();
f.controller.start();
assert.deepEqual(f.lifecycle(), {started: 1, closed: 0});
assert(f.send('on').wanted);
assert.equal(f.send('status').enabled, false, 'Acknowledging on must not claim a connection');
f.status({state: 'on', connected: false});
assert.equal(f.send('status').state, 'connecting');
f.status({state: 'on', connected: true, authenticated: true});
assert.equal(f.send('status').enabled, true);
assert.equal(f.send('off', 1700000000002).wanted, false);
assert.equal(f.send('on', 1700000000001).wanted, false, 'An older on must not override off');
assert.deepEqual(f.requests, ['on', 'off']);
assert.equal(f.send('on', 1700000060000).error, 'invalid_request');
assert.equal(f.send('exec').error, 'invalid_action');
assert.equal(f.controller.dispatch(null).error, 'invalid_action');
f.status({state: 'off', connected: false, quiescent: true});
f.send('status');
assert.equal(JSON.parse(f.files.get(f.root + '/state/provider.json')).disconnected, true);
f.controller.close();
assert.deepEqual(f.lifecycle(), {started: 1, closed: 1});

const auth = fixture();
auth.status({state: 'login', authenticated: false, authURL: 'https://login.example.invalid/EXAMPLE',
  PrivateKey: 'DO-NOT-LEAK', cookies: 'DO-NOT-LEAK'});
assert(!JSON.stringify(auth.send('status')).includes('DO-NOT-LEAK'));
assert.equal(auth.send('status').authURL, undefined);
// A direct provider snapshot is still filtered by the definition's login URL policy.
auth.controller.dispatch({action: 'on', issued: 1700000000000});
auth.status({state: 'login', authURL: 'https://evil.example/EXAMPLE'});
assert.equal(auth.controller.status(true).authURL, undefined);
auth.status({state: 'login', authURL: 'https://login.example.invalid/EXAMPLE'});
assert.equal(auth.controller.status(true).authURL, 'https://login.example.invalid/EXAMPLE');

const other = fixture('other-transport');
assert.equal(other.send('login').error, 'login_unsupported');
assert.equal(other.config.enabled, false, 'Unsupported login must not enable a provider');
assert(other.send('on').wanted);
other.status({state: 'on', connected: true, authenticated: true});
assert.equal(other.send('status').enabled, true, 'The same controller supports a different provider contract');
other.context.onFailure('network_probe_failed');
assert.equal(other.send('status').wanted, false);
assert.equal(other.config.failure, 'network_probe_failed');

assert.throws(() => fixture('other-transport', {provider: 'tailscale', disconnected: false}), /Disconnect/);
assert.doesNotThrow(() => fixture('other-transport', {provider: 'tailscale', disconnected: true}));
assert.throws(() => registry.get('../../untrusted'), /Unsupported/);
assert.throws(() => registry.get('constructor'), /Unsupported/);
assert.throws(() => registry.get('sing-box'), /Unsupported/, 'Unimplemented providers must fail explicitly');
const legacyFiles = new Map();
const legacy = {version: 1, enabled: false, ...example.providerConfig};
const legacyController = create({root: '/private/legacy-connection', config: legacy,
  fs: {readFileSync() { const e = Error('missing'); e.code = 'ENOENT'; throw e; },
    writeFileSync(name, data) { legacyFiles.set(name, data); },
    renameSync(from, to) { legacyFiles.set(to, legacyFiles.get(from)); legacyFiles.delete(from); }}});
assert.equal(legacyController.provider, 'tailscale', 'The installed flat config keeps its existing engine');
assert.equal(legacyController.status(false).wanted, false);
legacyController.close();
console.log('PASS: provider-independent control, intent ordering, status/auth filtering, safe switch guard and unsupported-provider rejection');
