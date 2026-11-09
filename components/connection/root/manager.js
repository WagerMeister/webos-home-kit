'use strict';
// Stable local control protocol. Transport details belong to provider modules.
var fs = require('fs'), net = require('net');
var registry = require('./providers');
var DEFAULT_ROOT = '/var/lib/webosbrew/tv-vpn'; // Preserve installed state paths.
var STATES = ['starting', 'on', 'off', 'off-login', 'login', 'approval', 'connecting',
  'disconnecting', 'endpoint-offline', 'failed', 'error', 'setup'];

function ownProcess(pid, needle, executable) {
  try {
    var actual = fs.statSync('/proc/' + pid + '/exe'), expected = fs.statSync(executable);
    return actual.dev === expected.dev && actual.ino === expected.ino &&
      /^Uid:\s+0\s/m.test(fs.readFileSync('/proc/' + pid + '/status', 'utf8')) &&
      fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').indexOf(needle) >= 0;
  } catch (error) { return false; }
}

function create(options) {
  var root = options.root, config = options.config, io = options.fs || fs;
  var getProvider = options.getProvider || registry.get, clock = options.now || Date.now;
  if (!config || config.version !== 1 || typeof config.enabled !== 'boolean') throw Error('Invalid connection configuration');
  var id = config.provider || 'tailscale', definition = getProvider(id);
  if (!definition || definition.id !== id) throw Error('Invalid provider registration');
  var ownerPath = root + '/state/provider.json', owner = null, engine;
  try { owner = JSON.parse(io.readFileSync(ownerPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (owner && owner.provider !== id && owner.disconnected !== true) {
    throw Error('Disconnect the previous provider before switching');
  }
  function atomic(file, value) {
    var temp = file + '.tmp-' + process.pid;
    io.writeFileSync(temp, JSON.stringify(value), {mode: 384});
    io.renameSync(temp, file);
  }
  function save() { atomic(root + '/config.json', config); }
  function record(disconnected) {
    if (owner && owner.provider === id && owner.disconnected === disconnected) return;
    owner = {provider: id, disconnected: disconnected};
    atomic(ownerPath, owner);
  }
  function failure(reason) {
    config.enabled = false;
    config.failure = /^[a-z][a-z0-9_]{0,63}$/.test(reason || '') ? reason : 'connection_failed';
    save();
  }
  function instantiate(selected, settings) {
    var instance = selected.create({
    root: root, settings: settings, enabled: config.enabled,
    failure: config.failure, onFailure: failure, ownProcess: options.ownProcess || ownProcess,
    log: options.log || function() {}, dependencies: options.dependencies
  });
  ['start', 'request', 'status', 'close'].forEach(function(method) {
    if (!instance || typeof instance[method] !== 'function') throw Error('Invalid provider contract');
  });
    return instance;
  }
  engine = instantiate(definition, config.providerConfig || config);
  function profile(provider) {
    if (provider === id) return config.providerConfig || config;
    return config.profiles && Object.prototype.hasOwnProperty.call(config.profiles, provider) ? config.profiles[provider] : null;
  }
  function candidates() {
    return (options.listProviders || registry.list)().filter(function(item) {
      var settings = profile(item.id);
      return settings && typeof settings === 'object' && typeof item.available === 'function' && item.available(root, settings);
    });
  }
  function engines() {
    var reply = status(false);
    reply.providers = candidates().map(function(item) { return {id: item.id, label: text(item.label, 64), selected: item.id === id}; });
    reply.canSelect = !config.enabled && reply.quiescent && !reply.busy;
    return reply;
  }
  function select(provider) {
    var allowed = candidates().filter(function(item) { return item.id === provider; });
    if (typeof provider !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(provider) || allowed.length !== 1) return {returnValue: false, error: 'provider_unavailable'};
    if (provider === id) return engines();
    var snapshot = status(false);
    if (config.enabled || !snapshot.quiescent || snapshot.busy) return {returnValue: false, error: 'disconnect_first'};
    var next = allowed[0], settings = profile(provider), replacement = instantiate(next, settings);
    engine.close();
    config.profiles = config.profiles || {};
    if (config.providerConfig) config.profiles[id] = config.providerConfig;
    else {
      var legacy = {};
      Object.keys(config).forEach(function(key) { if (['version','enabled','provider','profiles','failure','lastIntent'].indexOf(key) < 0) legacy[key] = config[key]; });
      config.profiles[id] = legacy;
    }
    config.provider = provider; config.providerConfig = settings; delete config.failure;
    id = provider; definition = next; engine = replacement; save(); record(false); engine.start();
    return engines();
  }
  function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function status(includeLogin) {
    var raw = engine.status(includeLogin) || {}, state = raw.state;
    if (state === 'exit-offline') state = 'endpoint-offline';
    if (STATES.indexOf(state) < 0) state = 'error';
    var connected = raw.connected === true && raw.state === 'on' && config.enabled;
    if (state === 'on' && !connected) state = config.enabled ? 'connecting' : 'disconnecting';
    var result = {
      returnValue: true, apiVersion: 1, state: state, enabled: connected, wanted: config.enabled,
      authenticated: raw.authenticated === true, loginReady: raw.loginReady === true,
      busy: raw.busy === true, quiescent: raw.quiescent === true,
      provider: id, providerName: text(definition.label, 64),
      capabilities: {browserLogin: !!(definition.capabilities && definition.capabilities.browserLogin)},
      clientVersion: text(raw.clientVersion, 32), hostname: text(raw.hostname, 64),
      endpoint: text(raw.endpoint, 80), dnsMode: text(raw.dnsMode, 32),
      lanAllowed: raw.lanAllowed === true,
      error: /^[a-z][a-z0-9_]{0,63}$/.test(raw.error || '') ? raw.error : null
    };
    if (includeLogin && result.capabilities.browserLogin &&
        typeof definition.validateAuthURL === 'function' && definition.validateAuthURL(raw.authURL)) {
      result.authURL = raw.authURL;
    }
    record(!config.enabled && result.quiescent && !connected);
    return result;
  }
  function dispatch(request) {
    if (!request || ['status', 'on', 'off', 'login', 'providers', 'select'].indexOf(request.action) < 0) {
      return {returnValue: false, error: 'invalid_action'};
    }
    if (request.action === 'providers') return engines();
    if (request.action !== 'status') {
      var now = clock(), issued = request.issued;
      if (typeof issued !== 'number' || !isFinite(issued) || Math.floor(issued) !== issued ||
          issued < now - 30000 || issued > now + 5000) return {returnValue: false, error: 'invalid_request'};
      if (config.lastIntent > now + 5000) config.lastIntent = 0;
      if (issued < (config.lastIntent || 0)) return status(false);
      if (request.action === 'login' && !(definition.capabilities && definition.capabilities.browserLogin)) {
        return {returnValue: false, error: 'login_unsupported'};
      }
      if (request.action === 'select') {
        var selected = select(request.provider);
        if (selected.returnValue) { config.lastIntent = issued; save(); }
        return selected;
      }
      config.lastIntent = issued;
      config.enabled = request.action !== 'off';
      delete config.failure;
      save();
      record(false);
      engine.request(request.action);
    }
    return status(request.action === 'login');
  }
  return {
    provider: id, dispatch: dispatch, status: status,
    start: function() { record(false); engine.start(); },
    close: function() { engine.close(); }
  };
}

function start(root) {
  root = root || DEFAULT_ROOT;
  var config = JSON.parse(fs.readFileSync(root + '/config.json', 'utf8'));
  var oldPid;
  try { oldPid = Number(fs.readFileSync(root + '/state/manager.pid', 'utf8')); } catch (error) {}
  if (oldPid && oldPid !== process.pid && ownProcess(oldPid, root + '/manager.js', '/usr/bin/node')) return null;
  [root, root + '/state', root + '/logs'].forEach(function(directory) {
    var info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 63)) throw Error('Unsafe controller directory');
  });
  function log(file, message) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 524288) fs.renameSync(file, file + '.old');
      message = String(message).replace(/https?:\/\/\S+/g, '[URL omitted]');
      fs.appendFileSync(file, new Date().toISOString() + ' ' + message + '\n', {mode: 384});
    } catch (error) { /* Logging must not affect playback or routing. */ }
  }
  var controller = create({root: root, config: config, log: log});
  var socket = root + '/state/control.sock', clients = [], tracking = null, closed = false;
  try {
    var info = fs.lstatSync(socket);
    if (!info.isSocket() || info.uid !== 0) throw Error('Unsafe control socket');
    fs.unlinkSync(socket);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  var server = net.createServer(function(client) {
    if (clients.length >= 6) { client.destroy(); return; }
    clients.push(client);
    client.setTimeout(4500, function() { client.destroy(); });
    client.on('error', function() { client.destroy(); });
    client.on('close', function() { clients = clients.filter(function(item) { return item !== client; }); });
    var buffer = '', handled = false;
    client.on('data', function(chunk) {
      if (handled) return;
      buffer += chunk;
      if (buffer.length > 256) { client.destroy(); return; }
      if (buffer.indexOf('\n') < 0) return;
      handled = true;
      var reply;
      try { reply = controller.dispatch(JSON.parse(buffer)); }
      catch (error) { reply = {returnValue: false, error: 'controller_error'}; }
      client.end(JSON.stringify(reply) + '\n');
    });
  });
  function close() {
    if (closed) return;
    closed = true;
    if (tracking !== null) clearInterval(tracking);
    controller.close();
    try { server.close(); } catch (error) { /* A failed listen is already closed. */ }
    clients.forEach(function(client) { client.destroy(); });
  }
  server.on('error', function(error) { log(root + '/logs/manager.log', 'control socket: ' + error.code); close(); process.exitCode = 1; });
  server.listen(socket, function() {
    fs.chmodSync(socket, 384);
    fs.writeFileSync(root + '/state/manager.pid', String(process.pid), {mode: 384});
    try { controller.start(); tracking = setInterval(function() { controller.status(false); }, 3000); }
    catch (error) { log(root + '/logs/manager.log', 'provider startup failed'); close(); process.exitCode = 1; }
  });
  return {controller: controller, close: close};
}

exports.create = create;
exports.start = start;
if (require.main === module) {
  var runtime = start();
  if (runtime) process.on('SIGTERM', function() { runtime.close(); process.exit(0); });
}
