'use strict';
// ES5 intentionally: run this file directly on the TV's Node.js 0.12.2 runtime.
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var handlers = {}, requests = [], mode = 'plain', noNormalize = false;
var liveURL = 'https://abc.playback.live-video.net/a/master.m3u8';
var title = new Array(200).join('x') + '\uD83D\uDD34tail';
var channel = { slug: 'example', playback_url: liveURL, livestream: { is_live: true, session_title: title } };
var recordings = [{ session_title: title, source: 'https://stream.kick.com/a/master.m3u8',
  video: { uuid: 'abc-123', is_private: false, status: 'public' }, duration: 60000 }];
var playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080,FRAME-RATE=60\n1080.m3u8\n';
function bytes(text) { return Buffer.from ? Buffer.from(text, 'utf8') : new Buffer(text, 'utf8'); }
var server = http.createServer(function (req, res) {
  if (mode === 'http') { res.writeHead(403); res.end(); return; }
  if (mode === 'aborted') { res.writeHead(200, { 'Content-Length': 10000 }); res.write('{'); setImmediate(function () { res.destroy(); }); return; }
  var body = req.url.indexOf('/api/') === 0 ? JSON.stringify(/\/videos$/.test(req.url) ? recordings : channel) : playlist;
  if (req.url.indexOf('/repos/') === 0) body = JSON.stringify({tag_name:'v0.10.0',html_url:'https://github.com/JirakJ/kick-web-os-app/releases/tag/v0.10.0',body:'Public release',draft:false,prerelease:false});
  if (mode === 'invalid') body = '{bad json';
  if (mode === 'large') body = new Array(1048578).join('x');
  if (mode === 'gzip' || mode === 'large' || mode === 'gzip-bad') {
    res.setHeader('Content-Encoding', 'gzip');
    res.end(mode === 'gzip-bad' ? bytes('invalid gzip') : zlib.gzipSync(bytes(body)));
  } else res.end(body);
});
var agent = new http.Agent({ keepAlive: true });
function loadService() {
  handlers = {};
  function Service(name) { assert.strictEqual(name, 'com.jakubjirak.service'); this.register = function (name, handler) { handlers[name] = handler; }; }
  var context = vm.createContext({
    require: function (name) {
      if (name === 'webos-service') return Service;
      if (name === 'zlib') return zlib;
      if (name === 'https') return { Agent: https.Agent, get: function (options, callback) {
        requests.push(options);
        assert.notStrictEqual(options.rejectUnauthorized, false);
        assert.strictEqual(options.headers['Accept-Encoding'], 'gzip');
        // Only the test transport uses loopback HTTP. Production retains Node HTTPS/TLS.
        return http.get({ hostname: '127.0.0.1', port: server.address().port,
          path: options.path, agent: options.agent === false ? false : agent, headers: options.headers }, callback);
      } };
      if(name==='./discovery')return require('./service/discovery');if(name==='./browser-session')return require('./service/browser-session');throw new Error('Unexpected dependency: ' + name);
    },
    Promise: Promise, Buffer: Buffer, setTimeout: setTimeout, clearTimeout: clearTimeout
  });
  vm.runInContext('Array.from = undefined;' + (noNormalize ? 'String.prototype.normalize = undefined;' : ''), context);
  vm.runInContext(fs.readFileSync('service/index.js', 'utf8'), context);
}
function invoke(method, payload) {
  return new Promise(function (resolve, reject) {
    var replies = 0;
    var timeout = setTimeout(function () { reject(new Error(method + ' did not reply')); }, 15000);
    try {
      handlers[method]({ payload: payload, respond: function (reply) {
        assert.strictEqual(++replies, 1, 'Exactly one reply per request');
        clearTimeout(timeout); resolve(reply);
      } });
    } catch (error) { clearTimeout(timeout); reject(error); }
  });
}
function expectChannel(reply) {
  assert.strictEqual(reply.returnValue, true);
  assert.strictEqual(reply.live.title, new Array(200).join('x') + '\uD83D\uDD34');
  assert.strictEqual(reply.videos[0].title, reply.live.title);
  assert.strictEqual(reply.videos[0].duration, 60);
  assert.strictEqual(reply.videosError, null);
}
function test() {
  ['app/app.js', 'app/player.js', 'app/i18n.js'].forEach(function (path) {
    vm.createScript(fs.readFileSync(path, 'utf8'), { filename: path });
  });
  loadService();
  return invoke('channel', { channel: 'example' }).then(function (reply) {
    expectChannel(reply);
    mode = 'gzip';
    return invoke('channel', { channel: 'example' });
  }).then(function (reply) {
    expectChannel(reply);
    return invoke('replay', {channel:'example',id:'abc-123'});
  }).then(function(reply) {
    assert.strictEqual(reply.video.id,'abc-123');
    assert.strictEqual(reply.video.url,'https://stream.kick.com/a/master.m3u8');
    recordings[0].video.is_private=true;
    return invoke('replay',{channel:'example',id:'abc-123'});
  }).then(function(reply) {
    assert.strictEqual(reply.video,null,'Private replay never resolves from history');
    recordings[0].video.is_private=false;
    return invoke('replay',{channel:'example',id:'missing'});
  }).then(function(reply) {
    assert.strictEqual(reply.video,null,'Unavailable replay is explicit');
    var before=requests.length;
    return invoke('replay',{channel:'../evil',id:'abc-123'}).then(function(r){assert.strictEqual(r.errorCode,'invalid_replay');assert.strictEqual(requests.length,before);});
  }).then(function(){
    var original=recordings[0];
    recordings=[];for(var i=0;i<31;i++){var clone=JSON.parse(JSON.stringify(original));clone.video.uuid='saved-'+i;recordings.push(clone);}
    return invoke('replay',{channel:'example',id:'saved-30'}).then(function(r){assert.strictEqual(r.video&&r.video.id,'saved-30','History lookup is not capped to the latest 30');recordings=[original];return invoke('statuses', { channels: ['example', 'missing'] });});
  }).then(function (reply) {
    assert.strictEqual(reply.statuses[0].live, true);
    assert.strictEqual(reply.statuses[1].live, null);
    return invoke('prepare', { url: 'https://stream.kick.com/a/{b}|\u010d.m3u8?token=a%2Fb%252F&x=1+2' });
  }).then(function (reply) {
    assert.strictEqual(reply.returnValue, true);
    assert.strictEqual(reply.best.height, 1080);
    assert.strictEqual(requests[requests.length - 1].hostname, 'stream.kick.com');
    assert.strictEqual(requests[requests.length - 1].path, '/a/%7Bb%7D%7C%C4%8D.m3u8?token=a%2Fb%252F&x=1+2');
    var count = requests.length;
    var bad = ['http://stream.kick.com/x.m3u8', 'https://stream.kick.com.evil.test/x.m3u8',
      'https://stream.kick.com@evil.test/x.m3u8', 'https://stream.kick.com:443/x.m3u8',
      'https://stream.kick.com\\@evil.test/x.m3u8', 'https://stream.kick.com/a\uD800.m3u8'];
    return Promise.all(bad.map(function (url) { return invoke('prepare', { url: url }).then(function (r) {
      assert.strictEqual(r.errorCode, 'bad_url');
    }); })).then(function () { assert.strictEqual(requests.length, count); });
  }).then(function () {
    mode = 'plain';
    title = '\uD83D\uDD34 \uFF34\uFF36 e\u030c';
    channel.livestream.session_title = recordings[0].session_title = title;
    return invoke('channel', { channel: 'example' });
  }).then(function (reply) {
    var expected = typeof title.normalize === 'function' ? title.normalize('NFKC') : title;
    assert.strictEqual(reply.live.title, expected);
    noNormalize = true; loadService();
    return invoke('channel', { channel: 'example' });
  }).then(function (reply) {
    assert.strictEqual(reply.live.title, title, 'Missing ICU keeps readable original text');
    return [ ['large', 'too_large'], ['gzip-bad', 'decode'], ['invalid', 'invalid_data'],
      ['http', 'http'], ['aborted', 'aborted'] ].reduce(function (chain, entry) {
      return chain.then(function () {
        mode = entry[0];
        return invoke('channel', { channel: 'example' }).then(function (r) {
          assert.strictEqual(r.returnValue, false);
          assert.strictEqual(r.errorCode, entry[1], mode + ': ' + JSON.stringify(r));
        });
      });
    }, Promise.resolve());
  }).then(function () {
    mode = 'plain';
    return invoke('channel', { channel: 'example' });
  }).then(function (reply) {
    assert.strictEqual(reply.returnValue, true, 'Service still works after failed transfers');
    return invoke('updates',{}).then(function (update) { assert.strictEqual(update.returnValue,true); assert.strictEqual(update.release.version,'0.10.0'); assert.strictEqual(requests[requests.length-1].hostname,'api.github.com'); });
  }).then(function () {
    console.log('Legacy service: passed on ' + process.version + ' (channel, replays, statuses, HLS, Unicode, gzip, limits and failures).');
  });
}
server.listen(0, '127.0.0.1', function () {
  test().then(function () { agent.destroy(); server.close(); }, function (error) {
    console.error(error.stack || error); agent.destroy(); server.close(); process.exitCode = 1;
  });
});
