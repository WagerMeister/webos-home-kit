'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../hearth-ui/connection.js'), 'utf8');

function mount(initial) {
  const calls = [], timers = [], nodes = [], listeners = {};
  function listen(type, fn) { (listeners[type] ||= []).push(fn); }
  let state = {...initial}, document;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
      this.className = ''; this.hidden = false; this.disabled = false;
      const classes = new Set();
      this.classList = {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)};
      nodes.push(this);
    }
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
    removeChild(node) { this.children = this.children.filter(child => child !== node); node.parentNode = null; }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ""; }
    click() { if (!this.disabled && this.onclick) this.onclick({stopPropagation() {}}); }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) {
      const all = this.children.flatMap(node => [node, ...descendants(node)]);
      return all.find(node => selector[0] === '.' && node.className.split(' ').includes(selector.slice(1))) || null;
    }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    contains(node) { return node === this || descendants(this).includes(node); }
  }
  function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
  const screen = new Node('main'), root = new Node('div'); root.appendChild(screen);
  document = {
    hidden: false, activeElement: null, documentElement: new Node('html'), body: new Node('body'),
    createElement: tag => new Node(tag), getElementById: id => id === 'root' ? root : null,
    querySelector: selector => selector === '#root > .screen' ? screen : null,
    addEventListener: listen
  };
  const window = {
    setTimeout(fn, delay) { const timer = {fn, delay, active: true}; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    addEventListener: listen, MutationObserver: function() { this.observe = () => {}; this.disconnect = () => {}; },
    PalmServiceBridge: function() {
      this.cancel = () => {};
      this.call = (uri, payload) => {
        const command = JSON.parse(payload).command;
        const action = command.match(/control\.js (status|on|off|login|providers|select) /)[1];
        calls.push(action);
        if (action === 'off') state = {...state, state: 'off', wanted: false, enabled: false};
        if (action === 'on') state = {...state, state: 'connecting', wanted: true, enabled: false};
        this.onservicecallback(JSON.stringify({returnValue: true, stdoutString: JSON.stringify({returnValue: true, ...state})}));
      };
    }
  };
  vm.runInNewContext(source, {window, document});
  const poll = timers.find(timer => timer.active && timer.delay === 100); assert(poll); poll.fn();
  const card = nodes.find(node => node.id === 'hearth-connection'); assert(card);
  return {calls, card, window, document,
    menu() { return nodes.find(node => node.className === 'hearth-connection-engines' && document.body.contains(node)); },
    event(type, keyCode) { const event = {type, keyCode, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }}; for (const fn of listeners[type] || []) fn(event); return event; },
    click() { card.onclick({stopPropagation() {}}); }};
}

for (const state of ['connecting', 'endpoint-offline', 'error']) {
  const app = mount({state, wanted: true, enabled: false, authenticated: true, capabilities: {browserLogin: true}});
  assert.equal(app.card.attributes['aria-checked'], 'false', 'Pending connection must not render active');
  app.click();
  assert.equal(app.calls.at(-1), 'off', 'OK must cancel an in-progress requested connection');
}
const profile = mount({state: 'setup', wanted: false, enabled: false, authenticated: false, capabilities: {browserLogin: false}});
profile.click();
assert.equal(profile.calls.at(-1), 'on');
assert(!profile.calls.includes('login'), 'A non-browser provider must not trigger a QR login');
const legacy = mount({state: 'off', enabled: false, authenticated: true});
legacy.click(); assert.equal(legacy.calls.at(-1), 'on', 'Legacy replies without wanted keep the old toggle behavior');
console.log('PASS: OK cancels pending connections, rendered truth stays separate from intent, profile-only engines do not open login');

const selector = mount({state: 'off', wanted: false, enabled: false, authenticated: true,
  canSelect: true, providers: [{id: 'tailscale', label: 'Tailscale', selected: true}]});
selector.window.__hearthConnectionSettings();
assert.equal(selector.document.activeElement.textContent, 'Tailscale · выбран');
assert(selector.event('keydown', 40).stopped, 'Dialog must isolate arrows from the launcher');
assert.equal(selector.document.activeElement.textContent, 'Обновить');
selector.event('keydown', 13); selector.event('keyup', 13);
assert.equal(selector.calls.at(-1), 'providers', 'OK activates the focused dialog action');
selector.event('keydown', 461);
assert(!selector.menu(), 'Back dismisses settings without closing Hearth');
selector.window.__hearthConnectionSettings();
selector.event('webOSRelaunch');
assert(!selector.menu(), 'Home/relaunch must not leave a stale modal on top');
console.log('PASS: settings discovery, remote arrow/OK isolation, Back and Home dismissal');
