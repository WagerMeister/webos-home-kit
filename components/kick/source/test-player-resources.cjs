'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
assert.equal(typeof global.gc, 'function', 'Run with --expose-gc');

function scenario(source) {
  const pendingPromises = [];
  let lastVideo;
  function createElement(tag) {
    const node = {
      children: [], handlers: {}, paused: true,
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
      setAttribute() {}, removeAttribute() {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      removeEventListener(name, callback) { if (this.handlers[name] === callback) delete this.handlers[name]; },
      pause() { this.paused = true; }, load() {},
      play() {
        this.paused = false;
        // A native media queue can keep its play promise unsettled after teardown.
        const promise = new Promise(function () {});
        pendingPromises.push(promise);
        return promise;
      }
    };
    if (tag === 'video') lastVideo = node;
    return node;
  }
  const host = createElement('host');
  const Player = vm.runInNewContext(source + '\nKickPlayer;', {
    document: { hidden: false, createElement }, navigator: { onLine: true },
    setTimeout, clearTimeout, performance
  });
  const player = Player(host, { change() {}, status() {} });
  player.load({ url: 'https://stream.kick.com/a/master.m3u8' });
  const retiredVideo = new WeakRef(lastVideo);
  player.stop();
  lastVideo = null;
  return { player, host, pendingPromises, retiredVideo };
}
(async function () {
  const retained = scenario(fs.readFileSync(process.argv[2] || 'app/player.js', 'utf8'));
  // WeakRef keeps targets alive until the current task ends; collect across tasks.
  for (let i = 0; i < 16; i++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
  assert.equal(retained.player.state().phase, 'idle');
  assert.equal(retained.host.children.length, 0);
  assert.equal(retained.pendingPromises.length, 1);
  assert.ok(retained.pendingPromises[0] instanceof Promise);
  assert.equal(retained.retiredVideo.deref(), undefined,
    'An unsettled play promise must not retain a disposed video');
  console.log('Player retention: passed with an unresolved play promise.');
}()).catch(error => { console.error(error); process.exitCode = 1; });
