const assert = require('node:assert/strict');
const channel = require('./app/app.js');

for (const [input, expected] of [
  ['  My_Channel-1  ', 'my_channel-1'],
  ['https://kick.com/Example/', 'example'],
  ['kick.com/example', 'example'],
  ['https://www.kick.com/example', 'example'],
  ['a'.repeat(25), 'a'.repeat(25)]
]) assert.equal(channel(input), expected);

for (const input of [null, {}, '', ' ', 'a'.repeat(26), 'foo bar',
  'https://evil.test/example', 'https://kick.com.evil.test/example',
  'https://kick.com@evil.test/example', '//evil.test/example',
  'https://kick.com/example/video', 'https://kick.com/example?x=1',
  'https://kick.com/%2e%2e', '../example', '<script>', 'foo&muted=true',
  'javascript:alert(1)', 'https://kick.com/example#fragment'
]) assert.equal(channel(input), '', String(input));

console.log('Channel validation: passed (valid names, links, length, URL injection).');

const vm = require('node:vm');
const fs = require('node:fs');
const appManifest=JSON.parse(fs.readFileSync('app/appinfo.json','utf8'));
const appVersion=appManifest.version;
const serviceId=appManifest.id+'.service';
assert.equal(appManifest.id,'com.jakubjirak');
const serviceManifest=JSON.parse(fs.readFileSync('service/services.json','utf8'));
assert.equal(serviceManifest.id,serviceId);
assert.deepEqual(serviceManifest.services.map(s=>s.name),[serviceId]);
assert.equal(JSON.parse(fs.readFileSync('service/package.json','utf8')).name,serviceId);
assert.equal(fs.readFileSync('app/index.html','utf8').match(/id="app-version">v([^<]+)</)[1],appVersion,'Footer must match the packaged app version');
let elements, document, window, navigator, bridges, timers, clock, created, textWrites, timerAllocations, wallClockOffset;
function element(id = '') {
  return {
    id, hidden: false, disabled: false, value: '', _text: '', children: [], attrs: {}, handlers: {},
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');},
    set textContent(value){textWrites[id]=(textWrites[id]||0)+1;this._text=String(value);this.children.forEach(c=>{c.parentNode=null;});this.children=[];},
    paused: true, _time: 0, duration: 300, readyState: 0, seeking: false, seeks: [], loads: [],
    get currentTime() { return this._time; },
    set currentTime(value) { this._time = value; this.seeks.push(value); this.seeking = true; },
    get firstChild() { return this.children[0]; },
    appendChild(child) { this.children.push(child); child.parentNode = this; if (child.id) elements[child.id] = child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(name, fn) { this.handlers[name] = fn; },
    removeEventListener(name, fn) { if (this.handlers[name] === fn) delete this.handlers[name]; },
    focus() {
      if(this.disabled)return;
      const old = document.activeElement;
      document.activeElement = this;
      if (old !== this && old?.handlers.blur) old.handlers.blur();
    },
    scrollIntoView() {},
    pause() { const changed = !this.paused; this.paused = true; if (changed) this.handlers.pause?.(); },
    play() { this.paused = false; return { then: (resolve,reject) => { this.rejectPlay = reject; } }; },
    load() { this.loads.push({sources:this.children.length,connected:!!this.parentNode,paused:this.paused,listeners:Object.keys(this.handlers).length}); }
  };
}
const stored = new Map();
const storage = {getItem(key){return stored.get(key)||null;},setItem(key,value){stored.set(key,value);}};
function boot(localStorage = storage, bridgeMode = 'ok', locale = 'cs-CZ', online = true, startClock = 1000, runtimeControl = null) {
  elements = {}; bridges = []; timers = new Map(); clock = startClock; created = {}; textWrites = {}; timerAllocations = 0; wallClockOffset = 0;
  const labelled=[];
  document = {hidden:false,activeElement:null,handlers:{},documentElement:{attrs:{},setAttribute(k,v){this.attrs[k]=v;}},
    getElementById(id){return elements[id];},createElement(tag){created[tag]=(created[tag]||0)+1;return element();},
    querySelectorAll(selector){assert.equal(selector,'[data-i18n],[data-i18n-attr]');return labelled;},
    addEventListener(name,fn){this.handlers[name]=fn;}};
  for(const [tag] of fs.readFileSync('app/index.html','utf8').matchAll(/<[a-z0-9]+\s[^>]*>/g)){
    const attrs=Object.fromEntries([...tag.matchAll(/([a-z0-9-]+)="([^"]*)"/g)].map(([,n,v])=>[n,v]));
    if(!attrs.id&&!attrs['data-i18n']&&!attrs['data-i18n-attr'])continue;
    const node=element(attrs.id||'');if(attrs.id)elements[attrs.id]=node;
    if(attrs.id==='app-version')node.textContent='v'+appVersion;
    for(const name of ['data-i18n','data-i18n-attr','placeholder','aria-label','aria-live','aria-atomic'])if(name in attrs)node.attrs[name]=attrs[name];
    if(attrs['data-i18n']||attrs['data-i18n-attr'])labelled.push(node);
  }
  window={innerWidth:1920,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},scrollTo(){}};
  navigator={onLine:online,language:locale};
  const context={document,window,navigator,localStorage,Date:{now:()=>clock+wallClockOffset},performance:{now:()=>clock},webOSSystem:{locale,platformBack(){}},
    setTimeout(fn,ms){timerAllocations++;const id={};timers.set(id,{fn,ms,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);}};
  if(runtimeControl)context.KickRuntime=runtimeControl;
  if(bridgeMode!=='missing')context.PalmServiceBridge=function(){
    if(bridgeMode==='throw')throw Error('bridge unavailable');
    bridges.push(this);
    this.call=(uri,payload)=>{assert.ok(uri.startsWith('luna://'+serviceId+'/'),'UI targets the packaged service');this.uri=uri;this.payload=JSON.parse(payload);};
    this.cancel=()=>{this.cancelled=true;};
  };
  if(locale===null){delete context.webOSSystem;delete navigator.language;}
  vm.createContext(context);
  vm.runInContext('Array.from = undefined;', context);
  vm.runInContext(fs.readFileSync('app/i18n.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/player.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/app.js','utf8'),context);
}
function advance(ms) {
  const until=clock+ms;let steps=0;
  while(true){
    const next=[...timers.entries()].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;
    assert.ok(++steps<1000,'Timers must remain bounded');
    timers.delete(next[0]);clock=next[1].at;next[1].fn();
  }
  clock=until;
}
const vod={title:'Záznam',url:'https://stream.kick.com/a/master.m3u8',date:'2026-09-12',duration:600};
const live={title:'Živý stream',url:'https://abc.us-west-2.playback.live-video.net/a/master.m3u8',isLive:true};
function node(){return elements['video-host'].firstChild;}
function videoSource(){return node()?.firstChild?.attrs.src;}
function options(){return JSON.parse(decodeURI(node().firstChild.attrs.type.split('mediaOption=')[1]));}
function ready(){const v=node();v.readyState=2;v.handlers.loadedmetadata();v.handlers.loadeddata();if(!v.paused)v.handlers.playing();}
function disposed(video){assert.deepEqual(Object.keys(video.handlers),[],'Retired media listeners are removed');assert.deepEqual(video.loads.at(-1),{sources:0,connected:false,paused:true,listeners:0},'Reset empty media after detaching to avoid native pending activity');}
function seeked(){node().seeking=false;node().handlers.seeked();}
function qualityResponse(){bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,best:{width:1920,height:1080,fps:60,bitrate:7000000}}));}
function respond(data={},prepare=true){
  bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,channel:elements.channel.value,live,videos:[vod],videosError:'',...data}));
  if(prepare&&bridges.at(-1)?.uri.endsWith('/prepare')&&!bridges.at(-1).cancelled){qualityResponse();ready();}
}
function submit(value){elements.channel.value=value;elements['channel-form'].handlers.submit({preventDefault(){}});}
function click(id){elements[id].handlers.click();}
function key(keyCode,extra={}){document.handlers.keydown({keyCode,target:document.activeElement,preventDefault(){},...extra});}
function exitWatch(){key(461);if(!elements.watch.hidden)key(461);}
function names(){return elements['recent-channels'].children.map(row=>row.firstChild.firstChild.textContent);}
function startVOD(){click('watch-recordings');elements.videos.firstChild.handlers.click();qualityResponse();ready();}

boot({getItem(){throw Error('Denied');},setItem(){throw Error('Full');}});
submit('https://evil.test/channel');assert.equal(bridges.length,0);
navigator.onLine=false;submit('example');assert.match(elements.error.textContent,/internetu/);
navigator.onLine=true;submit('example');respond();
assert.equal(videoSource(),live.url);assert.equal(node().muted,false);assert.equal(node().volume,1);
assert.deepEqual(names(),['example']);assert.match(elements.quality.textContent,/1080p/);
assert.equal(options().option.adaptiveStreaming.maxHeight,2160);
assert.equal(options().option.adaptiveStreaming.bps.start,7000000);
advance(6000);assert.equal(elements.back.hidden,true);assert.equal(elements['playback-controls'].hidden,true);
key(40);assert.equal(elements.back.hidden,false);
click('toggle');assert.equal(node().paused,true);click('toggle');assert.equal(node().paused,false);
node().handlers.playing();
const oldLive=node(), oldError=oldLive.handlers.error;document.hidden=true;document.handlers.visibilitychange();
assert.equal(videoSource(),undefined,'No decoder or background audio after leaving');
document.hidden=false;document.handlers.visibilitychange();assert.equal(videoSource(),undefined);
click('toggle');ready();assert.equal(videoSource(),live.url);
disposed(oldLive);
oldError();oldLive.rejectPlay({name:'NotAllowedError'});
assert.equal(elements['playback-status'].hidden,true,'Old media callbacks cannot change current playback');
startVOD();assert.equal(videoSource(),vod.url);
assert.equal(elements.timeline.hidden,false);
// Repeated seek keys are debounced, accumulate, and never overlap native seeks.
elements.watch.focus();key(39);key(39);key(39);advance(299);
assert.equal(node().seeks.length,0);
advance(1);assert.deepEqual(node().seeks,[30]);
key(39);advance(300);assert.deepEqual(node().seeks,[30]);
seeked();assert.deepEqual(node().seeks,[30,40]);seeked();
key(37);advance(300);seeked();assert.equal(node().currentTime,30);
click('toggle');assert.equal(node().paused,true);
elements.seek.value=180;elements.seek.handlers.input();assert.equal(elements.elapsed.textContent,'3:00');
assert.equal(node().currentTime,30,'Pointer drag only previews');
elements.seek.handlers.change();advance(300);seeked();assert.equal(node().currentTime,180);
assert.equal(node().paused,true,'Seeking preserves pause intent');
click('toggle');node().handlers.playing();elements.seek.focus();advance(6000);
assert.equal(elements.back.hidden,true);assert.equal(elements['playback-controls'].hidden,true,'Timeline blur cannot reopen hidden controls');
// Preserve position through visibility changes using native start time, avoiding an early seek.
node()._time=180;node().handlers.timeupdate();
document.hidden=true;document.handlers.visibilitychange();document.hidden=false;document.handlers.visibilitychange();
click('toggle');assert.equal(options().option.transmission.playTime.start,180000);ready();
// Decoder recovery retains the requested seek position and has a strict retry limit.
elements.seek.value=220;elements.seek.handlers.change();advance(300);
const broken=node(), oldPlaying=broken.handlers.playing;broken.error={code:3};broken.handlers.error();assert.equal(videoSource(),undefined);
advance(600);assert.notEqual(node(),broken);assert.equal(options().option.transmission.playTime.start,220000);
disposed(broken);
oldPlaying();assert.match(elements['playback-status'].textContent,/Načítání/);
node().error={code:3};node().handlers.error();advance(600);
node().error={code:3};node().handlers.error();advance(60000);
assert.equal(videoSource(),undefined);assert.match(elements['playback-status'].textContent,/chyba 3/);
assert.equal(elements.toggle.textContent,'Zkusit znovu');click('toggle');assert.equal(videoSource(),vod.url);ready();
// Back cancels every retry and pending seek; no later callback can resurrect a decoder.
node().error={code:3};node().handlers.error();exitWatch();advance(30000);
assert.equal(videoSource(),undefined);assert.equal(elements.catalog.hidden,false);
key(461);assert.equal(elements.home.hidden,false);
submit('offline-channel');respond({live:null});assert.equal(videoSource(),undefined);
assert.equal(elements.catalog.hidden,false);assert.equal(elements.videos.children.length,1);
click('catalog-back');submit('empty-channel');respond({live:null,videos:[]});assert.match(elements['videos-status'].textContent,/nemá/);
click('catalog-back');submit('failed');respond({returnValue:false,errorText:'HTTP 403'});
assert.match(elements['channel-status'].textContent,/403/);assert.equal(elements['catalog-retry'].hidden,false);
click('catalog-back');submit('bad-data');bridges.at(-1).onservicecallback('null');assert.equal(elements['catalog-retry'].hidden,false);
click('catalog-back');submit('first');const stale=bridges.at(-1);
click('catalog-back');submit('second');respond({live:null});stale.onservicecallback(JSON.stringify({returnValue:true,live,videos:[]}));
assert.equal(videoSource(),undefined);
click('catalog-back');submit('timeout');advance(18000);assert.match(elements['channel-status'].textContent,/neobdržela/);
boot(storage,'missing');submit('example');assert.match(elements['channel-status'].textContent,/služby/);
boot(storage,'throw');submit('example');assert.match(elements['channel-status'].textContent,/nelze spustit/);
boot();submit('example');const interruptedLookup=bridges.at(-1);
document.hidden=true;document.handlers.visibilitychange();document.hidden=false;document.handlers.visibilitychange();
assert.equal(elements['catalog-retry'].hidden,false);assert.match(elements['channel-status'].textContent,/přerušeno/);
interruptedLookup.onservicecallback(JSON.stringify({returnValue:true,live,videos:[]}));assert.equal(videoSource(),undefined);
click('catalog-retry');respond({live:null});assert.equal(elements.videos.children.length,1);
// An OK pressed while manifest preparation is pending must not mount another player.
boot();submit('example');respond({},false);elements.watch.focus();key(13);assert.equal(videoSource(),undefined);
qualityResponse();ready();assert.equal(elements['video-host'].children.length,1);
const count=bridges.length;key(13);key(13);node().handlers.playing();assert.equal(bridges.length,count);
// Both synchronous play failures and stalled streams recover without throwing or looping.
node().play=()=>{throw Error('native failure');};click('toggle');click('toggle');advance(600);
assert.equal(videoSource(),live.url);ready();advance(20000);assert.equal(videoSource(),undefined);advance(1800);
finishReconnect(live);assert.equal(videoSource(),live.url);click('back');advance(30000);assert.equal(videoSource(),undefined);
boot();
for(let i=0;i<8;i++){submit('channel-'+i);respond();click('back');}
assert.deepEqual(names(),['channel-7','channel-6','channel-5','channel-4','channel-3','channel-2']);
boot();assert.equal(elements.channel.value,'channel-7');
elements['recent-channels'].children[2].firstChild.handlers.click();respond();assert.equal(names()[0],'channel-5');
window.handlers.pagehide();assert.equal(videoSource(),undefined);
stored.set('kick-channel','legacy');
for(const bad of ['{broken','{}','null','false']){stored.set('kick-recent-channels',bad);boot();assert.deepEqual(names(),['legacy']);}
stored.set('kick-recent-channels',JSON.stringify(['Safe','safe',null,{},'<img>','https://evil.test/a','second']));boot();assert.deepEqual(names(),['safe','second']);
// Pause/resume while the original play promise is pending cannot inherit its rejection.
boot();submit('example');respond();click('toggle');click('toggle');const obsoletePlay=node().rejectPlay;
click('toggle');click('toggle');obsoletePlay({name:'NotAllowedError'});node().handlers.playing();
assert.equal(node().paused,false);assert.equal(elements['playback-status'].hidden,true);
click('back');
// Offline errors stop immediately; retry is an explicit user action.
boot();submit('example');respond();navigator.onLine=false;node().handlers.error();advance(60000);
assert.equal(videoSource(),undefined);assert.match(elements['playback-status'].textContent,/internetu/);
navigator.onLine=true;click('reconnect');advance(600);finishReconnect(live);assert.equal(videoSource(),live.url);
startVOD();node().handlers.ended();advance(60000);assert.equal(elements.toggle.textContent,'Pokračovat');
assert.match(elements['playback-status'].textContent,/skončil/);click('back');click('catalog-back');
// Grid pagination bounds image/DOM load and supports vertical remote navigation.
submit('example');respond({live:null,videos:Array.from({length:14},(_,i)=>({...vod,title:'Video '+i}))});
assert.equal(elements.videos.children.length,6);assert.equal(elements['page-number'].textContent,'1 / 3');
elements.videos.children[0].focus();key(40);assert.equal(document.activeElement,elements.videos.children[3]);
click('next-page');assert.equal(elements['page-number'].textContent,'2 / 3');
click('next-page');assert.equal(elements.videos.children.length,2);assert.equal(elements['next-page'].disabled,true);
// A seek entered while no decoder exists survives the next mount.
for(const interrupted of ['recovering','suspended']){
 boot();submit('example');respond();startVOD();
 node()._time=50;node().handlers.timeupdate();
 if(interrupted==='recovering'){node().error={code:3};node().handlers.error();}
 else{document.hidden=true;document.handlers.visibilitychange();document.hidden=false;document.handlers.visibilitychange();}
 elements.watch.focus();key(39);
 if(interrupted==='recovering')advance(600);else click('toggle');
 assert.equal(options().option.transmission.playTime.start,60000,'Keep a new seek target through '+interrupted+' mount');
 click('back');
}
// Completing an active seek consumes the pending debounce, rather than orphaning it.
boot();submit('example');respond();startVOD();elements.watch.focus();key(39);advance(300);
advance(50);key(39);advance(50);seeked();advance(50);seeked();advance(50);key(39);
advance(299);assert.deepEqual(node().seeks,[10,20],'An old debounce cannot start the next seek early');
advance(1);assert.deepEqual(node().seeks,[10,20,30]);seeked();
const retired=node();assert.equal(Object.keys(retired.handlers).length,11);
click('watch-recordings');assert.equal(timers.size,0,'Leaving playback cancels every media timer');
disposed(retired);
// Failed native operations must never reload an uncleared source during disposal.
for(const operation of ['pause','removeAttribute']){
 boot();submit('example');respond();const failed=node();
 failed[operation]=()=>{throw Error('failed decoder');};
 click('watch-recordings');assert.equal(videoSource(),undefined);
 assert.deepEqual(Object.keys(failed.handlers),[]);assert.equal(timers.size,0);
 if(operation==='pause')assert.equal(failed.loads.at(-1).sources,0,'Purge the source even if native pause fails');
 else assert.equal(failed.loads.length,1,'Never reload a source whose purge failed');
}
console.log('Player and TV UI: passed (serialized seeking, bounded recovery, stale events, stalled/failed media, lifecycle, API failures, history, grid navigation).');

// Favorites stay independent of recents and support persisted, cancellable ordering.
const favoriteHistory='[{"key":"alpha:saved","position":111,"duration":600,"finished":false}]';
const favoriteData=new Map([['kick-favorites',JSON.stringify(['Alpha','beta','alpha','bad name'])],['kick-watched-videos',favoriteHistory]]);
const favoriteStorage={getItem:k=>favoriteData.get(k)||null,setItem:(k,v)=>favoriteData.set(k,v)};
boot(favoriteStorage);
const favoriteNames=()=>elements['favorite-list']?.children.map(row=>row.firstChild.firstChild.textContent);
assert.deepEqual(favoriteNames(),['alpha','beta'],'Favorites canonicalize, deduplicate and render independently of recents');
assert.equal(elements.recent.hidden,true);
elements['favorite-list'].firstChild.firstChild.focus();key(38);assert.equal(document.activeElement,elements.recordings,'Up from favorites-only home reaches an enabled action');
assert.equal(elements['favorite-list'].firstChild.firstChild.children[1].textContent,'Stav není dostupný');
const favoriteStatus=bridges.find(b=>b.uri.endsWith('/statuses'));
favoriteStatus.onservicecallback(JSON.stringify({returnValue:true,statuses:[{channel:'alpha',live:true},{channel:'beta',live:false}]}));
assert.equal(elements['favorite-list'].firstChild.firstChild.children[1].textContent,'ŽIVĚ');
assert.equal(elements['favorite-list'].children[1].firstChild.children[1].textContent,'Offline');
elements.channel.value='Gamma';elements.channel.handlers.input();click('favorite-channel');
assert.deepEqual(JSON.parse(favoriteData.get('kick-favorites')),['alpha','beta','gamma']);
submit('alpha');respond({live:null});click('catalog-back');
assert.deepEqual(favoriteNames(),['alpha','beta','gamma'],'Opening a channel never reorders favorites');
elements['recent-channels'].firstChild.children[2].handlers.click();
assert.deepEqual(favoriteNames(),['alpha','beta','gamma'],'Removing recents cannot remove favorites');
assert.equal(favoriteData.get('kick-watched-videos'),favoriteHistory,'Favorite changes preserve replay history');
assert.equal(elements['favorite-channel'].disabled,true,'Removing the last recent updates the empty channel action');
// A recent-row heart changes favorites without removing or opening that channel.
const heartData=new Map([['kick-recent-channels','["alpha","beta"]'],['kick-channel','alpha'],['kick-favorites','["alpha"]']]);
boot({getItem:k=>heartData.get(k)||null,setItem:(k,v)=>heartData.set(k,v)});
elements['recent-channels'].children[1].children[1].handlers.click();
assert.deepEqual(JSON.parse(heartData.get('kick-favorites')),['alpha','beta'],'Row heart favorites its own channel without deleting the recent row');
assert.deepEqual(names(),['alpha','beta']);assert.equal(elements.channel.value,'alpha');
assert.equal(elements['recent-channels'].children[1].children[1].attrs['aria-pressed'],'true');
elements['recent-channels'].children[0].children[1].focus();key(40);assert.equal(document.activeElement,elements['recent-channels'].children[1].children[1],'Down preserves the heart column');
elements['recent-channels'].children[0].children[1].handlers.click();assert.deepEqual(JSON.parse(heartData.get('kick-favorites')),['beta']);assert.deepEqual(names(),['alpha','beta']);
assert.equal(elements['favorite-channel'].attrs['aria-pressed'],'false');
elements['recent-channels'].children[1].children[1].focus();key(40);assert.equal(document.activeElement,elements['about-button'],'Down at the bottom of a home column reaches the footer rather than another column');
boot(favoriteStorage);
// Reordering previews in memory; Back cancels and Save persists.
elements['favorite-list'].children[1].children[1].handlers.click();assert.equal(elements['favorite-move'].hidden,false);
key(9,{shiftKey:true});assert.equal(document.activeElement,elements['favorite-move-cancel']);key(9);assert.equal(document.activeElement,elements['favorite-move-up']);
click('favorite-move-up');assert.deepEqual(favoriteNames(),['beta','alpha','gamma']);
assert.deepEqual(JSON.parse(favoriteData.get('kick-favorites')),['alpha','beta','gamma']);key(461);
assert.deepEqual(favoriteNames(),['alpha','beta','gamma']);assert.equal(elements['favorite-move'].hidden,true);
elements['favorite-list'].children[1].children[1].handlers.click();click('favorite-move-up');click('favorite-move-save');
assert.deepEqual(JSON.parse(favoriteData.get('kick-favorites')),['beta','alpha','gamma']);
boot(favoriteStorage);assert.deepEqual(favoriteNames(),['beta','alpha','gamma'],'Chosen order survives an app restart');
// Removing a favorite invalidates its status cache, bounding retained channel entries.
const cacheFavorites=new Map([['kick-favorites','["cache-one","cache-two"]']]);
boot({getItem:k=>cacheFavorites.get(k)||null,setItem:(k,v)=>cacheFavorites.set(k,v)});
bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,statuses:[{channel:'cache-one',live:true},{channel:'cache-two',live:false}]}));
const cachedRequests=bridges.length;elements['favorite-list'].firstChild.children[2].handlers.click();
elements.channel.value='cache-one';elements.channel.handlers.input();click('favorite-channel');
assert.equal(bridges.length,cachedRequests+1,'A removed favorite cannot retain stale status when re-added');
assert.deepEqual(bridges.at(-1).payload.channels,['cache-one']);
const fullFavorites=new Map([['kick-favorites',JSON.stringify(Array.from({length:50},(_,i)=>'fav-'+i))]]);
boot({getItem:k=>fullFavorites.get(k)||null,setItem:(k,v)=>fullFavorites.set(k,v)});
assert.equal(favoriteNames().length,6);
elements['favorite-list'].children[5].children[1].handlers.click();click('favorite-move-down');assert.equal(elements['favorite-number'].textContent,'2 / 9');key(461);
assert.equal(elements['favorite-number'].textContent,'1 / 9');assert.equal(favoriteNames()[5],'fav-5');
assert.equal(JSON.parse(fullFavorites.get('kick-favorites'))[5],'fav-5');
elements.channel.value='extra';elements.channel.handlers.input();click('favorite-channel');
assert.equal(JSON.parse(fullFavorites.get('kick-favorites')).length,50);assert.match(elements['favorite-feedback'].textContent,/50/);
for(let i=0;i<8;i++)click('favorite-next');assert.equal(favoriteNames().length,2);
elements['favorite-list'].firstChild.children[2].handlers.click();elements['favorite-list'].firstChild.children[2].handlers.click();
assert.equal(favoriteNames().length,6);assert.equal(elements['favorite-number'].textContent,'8 / 8');
boot({getItem(){throw Error('Denied');},setItem(){throw Error('Quota');}});
elements.channel.value='session';elements.channel.handlers.input();click('favorite-channel');assert.deepEqual(favoriteNames(),['session']);
// Visible favorites and recents share sequential status batches; hidden pages are not queried.
boot({getItem:k=>k==='kick-favorites'?JSON.stringify(Array.from({length:12},(_,i)=>'pinned-'+i)):k==='kick-recent-channels'?JSON.stringify(Array.from({length:12},(_,i)=>'recent-'+i)):null,setItem(){}});
const unionStatuses=()=>bridges.filter(b=>b.uri.endsWith('/statuses'));
assert.equal(unionStatuses().length,1);assert.deepEqual(unionStatuses()[0].payload.channels,['pinned-0','pinned-1','pinned-2','pinned-3','pinned-4','pinned-5']);
unionStatuses()[0].onservicecallback(JSON.stringify({returnValue:true,statuses:unionStatuses()[0].payload.channels.map(channel=>({channel,live:false}))}));
assert.equal(unionStatuses().length,2);assert.deepEqual(unionStatuses()[1].payload.channels,['recent-0','recent-1','recent-2','recent-3','recent-4','recent-5']);
unionStatuses()[1].onservicecallback(JSON.stringify({returnValue:true,statuses:unionStatuses()[1].payload.channels.map(channel=>({channel,live:false}))}));
document.hidden=true;document.handlers.visibilitychange();const beforeHiddenStatuses=bridges.length;advance(120000);
assert.equal(bridges.length,beforeHiddenStatuses,'No hidden-page or background polling after suspension');
// Favorite feedback must never replace the channel's loading/error status.
boot({getItem(){return null;},setItem(){}},'missing');submit('example');
const catalogFailure=elements['channel-status'].textContent;click('catalog-favorite');
assert.equal(elements['channel-status'].textContent,catalogFailure,'Favoriting keeps the channel service error visible');
console.log('Favorites: passed (canonicalization, independent history, ordering, cancel/save, bounds, status and storage failures).');

// Quality choices change the native source, preserving paused replay position.
const qualityStore={data:{},getItem(k){return this.data[k]||null;},setItem(k,v){this.data[k]=v;}};
const variants=[{width:1920,height:1080,fps:60,bitrate:7000000,url:'https://stream.kick.com/a/1080.m3u8',manual:true},
 {width:1280,height:720,fps:30,bitrate:3000000,url:'https://stream.kick.com/a/720.m3u8',manual:true},
 {width:854,height:480,fps:30,bitrate:1000000,url:'https://stream.kick.com/a/480.m3u8',manual:false}];
function preparedVariants(){bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,best:variants[0],variants}));ready();}
boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[vod]});
elements.videos.firstChild.handlers.click();preparedVariants();
assert.equal(elements['quality-button'].disabled,false);click('quality-button');
assert.equal(elements['quality-choice'].hidden,false);assert.equal(elements['quality-options'].children.length,4);
advance(6001);assert.equal(document.activeElement,elements['quality-options'].children[0],'Controls must not steal modal focus');
assert.equal(elements['quality-options'].children[3].disabled,true,'External audio rendition cannot silently lose sound');
node().currentTime=123;node().handlers.timeupdate();click('toggle');const qualityOld=node();
elements['quality-options'].children[2].handlers.click();
assert.equal(videoSource(),variants[1].url);disposed(qualityOld);assert.equal(node().paused,true);
assert.equal(options().option.transmission.playTime.start,123000);ready();
// webOS 5 emits a zero DOM time while a paused native transmission start is already 123s.
node()._time=0;node().handlers.timeupdate();
assert.equal(elements.elapsed.textContent,'2:03','Paused quality mount keeps its requested position until native time acknowledges it');
assert.equal(elements['video-host'].children.length,1);assert.equal(qualityStore.data['kick-quality-preference'],'720');
assert.match(elements['quality-selection'].textContent,/720p/);assert.match(elements['quality-actual'].textContent,/unavailable/i);
click('quality-button');elements['quality-options'].children[0].handlers.click();assert.equal(videoSource(),vod.url);
assert.equal(node().paused,true);assert.equal(options().option.transmission.playTime.start,123000);
ready();node()._time=0;node().handlers.timeupdate();assert.equal(elements.elapsed.textContent,'2:03');
node()._time=123.25;node().handlers.timeupdate();assert.equal(elements.elapsed.textContent,'2:03','Native positive time acknowledges the transmission start');
node()._time=124;node().handlers.timeupdate();assert.equal(elements.elapsed.textContent,'2:04','Acknowledged time updates remain authoritative while paused');
click('quality-button');elements['quality-options'].children[2].handlers.click();ready();node()._time=0;node().handlers.timeupdate();
elements.seek.value='0';elements.seek.handlers.input();elements.seek.handlers.change();advance(300);node().seeking=false;node().handlers.seeked();
node()._time=0;node().handlers.timeupdate();assert.equal(elements.elapsed.textContent,'0:00','Explicit seek to zero acknowledges a new target while native start is pending');
click('quality-button');elements['quality-options'].children[0].handlers.click();assert.equal(options().option.transmission,undefined,'The following source change preserves the deliberate seek to zero');
click('quality-button');key(461);assert.equal(elements['quality-choice'].hidden,true);assert.equal(videoSource(),vod.url);
click('quality-button');document.hidden=true;document.handlers.visibilitychange();assert.equal(elements['quality-choice'].hidden,true);
qualityStore.data['kick-quality-preference']='1440';boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[vod]});
elements.videos.firstChild.handlers.click();preparedVariants();assert.equal(videoSource(),vod.url);assert.match(elements['quality-selection'].textContent,/unavailable.*Auto/i);

// An interrupted second preparation must not reuse the previous resume target.
const interruptedReplay={...vod,id:'resume-interrupted'};
const interruptedStore={getItem(k){return k==='kick-watched-videos'?JSON.stringify([{key:'example:resume-interrupted',position:123,duration:600,finished:false}]):null;},setItem(){}};
boot(interruptedStore,'ok','en-US');submit('example');respond({live:null,videos:[interruptedReplay]});elements.videos.firstChild.handlers.click();click('resume-continue');qualityResponse();ready();assert.equal(options().option.transmission.playTime.start,123000);
click('watch-recordings');elements.videos.firstChild.handlers.click();click('resume-start');const interruptedPrepare=bridges.at(-1);
document.hidden=true;document.handlers.visibilitychange();document.hidden=false;document.handlers.visibilitychange();click('toggle');
assert.equal(videoSource(),undefined,'An interrupted Start over must prepare again before mounting');assert.equal(interruptedPrepare.cancelled,true);assert.notEqual(bridges.at(-1),interruptedPrepare);
qualityResponse();ready();assert.equal(options().option.transmission,undefined,'Start over cannot inherit the previous saved position');
boot({getItem(){return null;},setItem(){}},'ok','en-US');submit('example');respond({live:null,videos:[interruptedReplay]});elements.videos.firstChild.handlers.click();
document.hidden=true;document.handlers.visibilitychange();document.hidden=false;document.handlers.visibilitychange();
assert.equal(elements['quality-button'].disabled,true,'Initial cancelled preparation cannot expose incomplete quality metadata');
click('quality-button');assert.equal(elements['quality-choice'].hidden,true);
elements.watch.focus();key(415);assert.equal(videoSource(),undefined);qualityResponse();ready();assert.equal(videoSource(),interruptedReplay.url);

// Dedicated transport keys retain pause/play intent inside playback dialogs.
boot({getItem(){return null;},setItem(){}},'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'transport-replay'}]});openReplay();
click('quality-button');const transportFocus=document.activeElement;key(19);assert.equal(node().paused,true,'Pause works inside quality dialog');
assert.equal(elements['quality-choice'].hidden,false);assert.equal(document.activeElement,transportFocus);key(415);assert.equal(node().paused,false);key(179);assert.equal(node().paused,true);click('quality-cancel');
click('jump-time');const jumpTransportFocus=document.activeElement;key(415);assert.equal(node().paused,false);navigator.onLine=false;window.handlers.offline();key(19);
navigator.onLine=true;window.handlers.online();const dialogPauseCalls=bridges.length;advance(60000);assert.equal(bridges.length,dialogPauseCalls,'Pause inside Jump forbids online recovery');
assert.equal(videoSource(),undefined);assert.equal(document.activeElement,jumpTransportFocus);assert.equal(elements['jump-dialog'].hidden,false);
key(415);advance(600);finishReconnect({...vod,id:'transport-replay',url:'https://stream.kick.com/transport/master.m3u8'});assert.equal(node().paused,false);assert.equal(elements['jump-dialog'].hidden,false);
node().error={code:2};node().handlers.error();advance(1800);const pendingDialogRecovery=bridges.at(-1);key(19);assert.equal(pendingDialogRecovery.cancelled,true);
pendingDialogRecovery.onservicecallback(JSON.stringify({returnValue:true,video:{...vod,id:'transport-replay'}}));advance(30000);assert.equal(videoSource(),undefined);exitWatch();click('watch-recordings');
console.log('Quality choices: passed (validated variants, paused position, Auto fallback, persistence and lifecycle).');

// Network recovery refreshes identity metadata instead of reusing an expired signed source.
const freshReplay={...vod,id:'network-replay',url:'https://stream.kick.com/fresh/master.m3u8?new=1'};
function finishReconnect(video=freshReplay){
 const bridge=bridges.at(-1);assert.ok(/\/(?:replay|channel)$/.test(bridge.uri));
 bridge.onservicecallback(JSON.stringify(bridge.uri.endsWith('/replay')?{returnValue:true,video}:{returnValue:true,channel:'example',videos:[],live:video}));
 qualityResponse();ready();
}
boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'network-replay'}]});openReplay();
node()._time=144;node().handlers.timeupdate();const offlineVideo=node();navigator.onLine=false;window.handlers.offline();
assert.equal(videoSource(),undefined);disposed(offlineVideo);assert.match(elements['playback-status'].textContent,/internet/i);
navigator.onLine=true;window.handlers.online();window.handlers.online();advance(600);
assert.equal(bridges.at(-1).uri.endsWith('/replay'),true);assert.equal(bridges.at(-1).payload.id,'network-replay');
const resolving=bridges.at(-1), resolvingCount=bridges.length;window.handlers.online();assert.equal(bridges.length,resolvingCount);
finishReconnect();assert.equal(videoSource(),freshReplay.url);assert.equal(options().option.transmission.playTime.start,144000);
node().error={code:2};node().handlers.error();advance(1800);const cancelledReconnect=bridges.at(-1);click('toggle');
assert.equal(cancelledReconnect.cancelled,true);cancelledReconnect.onservicecallback(JSON.stringify({returnValue:true,video:freshReplay}));assert.equal(videoSource(),undefined);
window.handlers.online();advance(6000);assert.equal(videoSource(),undefined,'Pause forbids automatic recovery');
click('reconnect');advance(600);finishReconnect();assert.equal(node().paused,true,'Explicit reconnect preserves a paused viewer');
click('toggle');node().handlers.playing();node().error={code:2};node().handlers.error();advance(1800);
const leavingReconnect=bridges.at(-1);exitWatch();assert.equal(leavingReconnect.cancelled,true);
leavingReconnect.onservicecallback(JSON.stringify({returnValue:true,video:freshReplay}));advance(60000);assert.equal(videoSource(),undefined);
boot(qualityStore,'ok','en-US');submit('example');respond();node().error={code:2};node().handlers.error();advance(600);
bridges.at(-1).onservicecallback(JSON.stringify({returnValue:false}));advance(1800);
bridges.at(-1).onservicecallback(JSON.stringify({returnValue:false}));const exhausted=bridges.length;advance(60000);window.handlers.online();assert.equal(bridges.length,exhausted,'Exhaustion requires explicit retry');
assert.match(elements['playback-status'].textContent,/Reconnect/i);click('reconnect');advance(600);finishReconnect({...live,url:'https://stream.kick.com/new-live/master.m3u8'});
assert.equal(videoSource(),'https://stream.kick.com/new-live/master.m3u8');

// Paused/ended/hidden sessions never restart on online; flapping retains its budget.
click('toggle');navigator.onLine=false;window.handlers.offline();navigator.onLine=true;window.handlers.online();
const pausedBridges=bridges.length;advance(60000);assert.equal(bridges.length,pausedBridges);assert.equal(videoSource(),undefined);
click('reconnect');advance(600);bridges.at(-1).onservicecallback(JSON.stringify({returnValue:false}));
assert.equal(elements['playback-status'].textContent,'Connection could not be restored. Select Reconnect to try again.','A failed paused reconnect must not leave a spinner');
boot(qualityStore,'ok','en-US');submit('example');respond();
for(let i=0;i<3;i++){navigator.onLine=false;window.handlers.offline();navigator.onLine=true;window.handlers.online();advance(1800);}
const flapBridges=bridges.length;advance(60000);window.handlers.online();assert.equal(bridges.length,flapBridges);
click('reconnect');advance(600);const hiddenRecovery=bridges.at(-1);document.hidden=true;document.handlers.visibilitychange();
assert.equal(hiddenRecovery.cancelled,true);hiddenRecovery.onservicecallback(JSON.stringify({returnValue:true,channel:'example',live,videos:[]}));
document.hidden=false;document.handlers.visibilitychange();window.handlers.online();advance(60000);assert.equal(videoSource(),undefined);

boot(qualityStore,'ok','en-US');submit('example');respond();navigator.onLine=false;window.handlers.offline();
assert.equal(elements.toggle.textContent,'Pause');click('toggle');assert.equal(elements.toggle.textContent,'Resume');
navigator.onLine=true;window.handlers.online();const offlinePauseRequests=bridges.length;advance(60000);assert.equal(bridges.length,offlinePauseRequests,'Offline Pause forbids automatic recovery');
click('reconnect');advance(600);const pausedLookup=bridges.at(-1);click('toggle');assert.equal(bridges.at(-1),pausedLookup,'Play during a pending reconnect reuses the lookup');
finishReconnect(live);assert.equal(node().paused,false,'Explicit Play updates intent while reconnect is pending');

boot(qualityStore,'ok','en-US');submit('example');respond({},false);preparedVariants();click('quality-button');
const obsoleteQuality=elements['quality-options'].firstChild;node().error={code:2};node().handlers.error();
assert.equal(elements['quality-choice'].hidden,true,'Network entry closes old rendition choices');
obsoleteQuality.handlers.click();assert.equal(videoSource(),undefined,'A stale quality choice cannot bypass source refresh');
advance(600);finishReconnect({...live,url:'https://stream.kick.com/refreshed/master.m3u8'});assert.equal(elements['quality-button'].disabled,false);
console.log('Network reconnect: passed (fresh sources, position, intent, single lookup, cancellation and bounded retries).');

// Search only loaded local data; cancel restores the catalog and focus.
const searchStore={getItem(k){return k==='kick-recent-channels'?JSON.stringify(['alpha','beta','alpha_2']):k==='kick-watched-videos'?JSON.stringify([
 {key:'example:search-a',position:30,duration:600,finished:false},{key:'example:search-c',position:600,duration:600,finished:true}]):null;},setItem(){}};
boot(searchStore,'ok','en-US');click('find-saved');const searchCalls=bridges.length;
elements['saved-query'].value='ALP';elements['saved-query'].handlers.input();assert.equal(elements['saved-results'].children.length,2);
assert.equal(bridges.length,searchCalls);key(461);assert.equal(elements['saved-search'].hidden,true);assert.equal(document.activeElement,elements['find-saved']);
submit('example');respond({live:null,videos:[{...vod,id:'search-a',title:'Čaj 🐸',date:'2026-10-01'},
 {...vod,id:'search-b',title:'Alfa',date:'2026-09-01'},{...vod,id:'search-c',title:'Žába',date:'2026-08-01'}]});
const searchTitles=()=>elements.videos.children.map(v=>v.children[1].textContent);const catalogCalls=bridges.length;
click('catalog-search');click('replay-filter');assert.deepEqual(searchTitles(),['Čaj 🐸']);click('replay-filter');assert.deepEqual(searchTitles(),['Alfa']);
click('replay-filter');assert.deepEqual(searchTitles(),['Žába']);click('replay-filter');click('replay-sort');assert.deepEqual(searchTitles(),['Žába','Alfa','Čaj 🐸']);
elements['replay-query'].value='🐸';elements['replay-query'].handlers.input();assert.deepEqual(searchTitles(),['Čaj 🐸']);
assert.equal(bridges.length,catalogCalls);assert.match(elements['search-scope'].textContent,/loaded.*30/i);key(461);
assert.deepEqual(searchTitles(),['Čaj 🐸','Alfa','Žába']);assert.equal(document.activeElement,elements['catalog-search']);
click('catalog-search');elements['replay-query'].value='missing';elements['replay-query'].handlers.input();assert.equal(elements.videos.children.length,0);assert.equal(elements['replay-result-count'].textContent,'Results: 0','Empty results must be visible inside the dialog');
click('replay-reset');click('replay-apply');assert.equal(elements['replay-tools'].hidden,true);assert.equal(elements.videos.children.length,3);
assert.equal(document.activeElement,elements.videos.firstChild);key(461);submit('second');respond({live:null,videos:[{...vod,id:'new',title:'New'}]});assert.deepEqual(searchTitles(),['New']);
boot(searchStore,'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'unicode-search',title:'🐸'.repeat(100)+' target'}]});
click('catalog-search');elements['replay-query'].value='target';elements['replay-query'].handlers.input();assert.equal(elements.videos.children.length,1,'Search includes the full 200-code-point title');key(461);
console.log('Local search: passed (saved channels, Unicode titles, viewing filters, deterministic sort, cancel/focus and no per-key requests).');

// Large jumps preview without native seeks until explicit confirmation.
boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'long-replay',duration:18000}]});openReplay();
node().duration=18000;node().handlers.durationchange();node()._time=120;node().handlers.timeupdate();click('toggle');
click('jump-time');assert.equal(elements['jump-dialog'].hidden,false);click('jump-forward');assert.equal(node().seeks.length,0);
assert.match(elements['jump-preview'].textContent,/12:00/);click('jump-cancel');advance(300);assert.equal(node().seeks.length,0);
click('jump-time');elements['jump-hours'].value='2';elements['jump-minutes'].value='34';elements['jump-seconds'].value='56';elements['jump-seconds'].handlers.input();
assert.match(elements['jump-preview'].textContent,/2:34:56/);click('jump-confirm');advance(300);assert.deepEqual(node().seeks,[9296]);seeked();assert.equal(node().paused,true);
click('jump-time');elements['jump-minutes'].value='60';click('jump-confirm');assert.equal(elements['jump-dialog'].hidden,false);assert.ok(elements['jump-error'].textContent);
elements['jump-hours'].value='700';elements['jump-minutes'].value='00';elements['jump-seconds'].value='00';elements['jump-hours'].handlers.input();click('jump-confirm');advance(300);assert.equal(node().seeks.at(-1),17999.9);seeked();
click('jump-time');key(461);assert.equal(elements['jump-dialog'].hidden,true);assert.equal(document.activeElement,elements['jump-time']);
elements.watch.focus();key(37);advance(300);seeked();assert.equal(node().seeks.at(-1),17989.9,'Single arrows retain 10-second steps');
key(417);assert.equal(elements['jump-dialog'].hidden,false);const beforeFastSeek=node().seeks.length;key(417);key(412);advance(300);assert.equal(node().seeks.length,beforeFastSeek);
document.hidden=true;document.handlers.visibilitychange();assert.equal(elements['jump-dialog'].hidden,true);document.hidden=false;document.handlers.visibilitychange();advance(60000);assert.equal(videoSource(),undefined);
boot(qualityStore,'ok','en-US');submit('example');respond();assert.equal(elements['jump-time'].hidden,true);key(417);assert.equal(elements['jump-dialog'].hidden,true);

// A committed target survives decoder recovery without an overlapping seek.
boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'recover-jump'}]});openReplay();node().error={code:3};node().handlers.error();
click('jump-time');elements['jump-hours'].value='0';elements['jump-minutes'].value='04';elements['jump-seconds'].value='00';click('jump-confirm');advance(600);
assert.equal(options().option.transmission.playTime.start,240000);assert.equal(node().seeks.length,0);exitWatch();advance(60000);assert.equal(videoSource(),undefined);
boot(qualityStore,'ok','en-US');submit('example');respond({live:null,videos:[{...vod,id:'duration-correction'}]});openReplay();
node().duration=600;node().handlers.durationchange();click('jump-time');elements['jump-hours'].value='0';elements['jump-minutes'].value='09';elements['jump-seconds'].value='00';elements['jump-minutes'].handlers.input();assert.match(elements['jump-preview'].textContent,/9:00/);
node().duration=300;node().handlers.durationchange();assert.match(elements['jump-preview'].textContent,/4:59/,'Preview follows corrected native duration before confirmation');key(461);
console.log('Long replay jumps: passed (preview/confirm/cancel, validation, clamping, paused seeks and suspend/live guards).');

// Updates are viewer initiated, bounded, plain-text and tied to the official repository.
const updateStore={data:{},getItem(k){return this.data[k]||null;},setItem(k,v){this.data[k]=v;}};
function updateReply(version='0.10.0',extra={}){bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,release:{version,url:'https://github.com/JirakJ/kick-web-os-app/releases/tag/v'+version,notes:'<script>plain notes</script>',checkedAt:clock,...extra}}));}
boot(updateStore,'ok','en-US');const startupRequests=bridges.length;click('about-button');assert.equal(bridges.length,startupRequests,'Opening About must not automatically check');
click('check-updates');assert.ok(bridges.at(-1).uri.endsWith('/updates'));updateReply();assert.match(elements['update-status'].textContent,/available/i);
const cachedUpdateCalls=bridges.length;click('check-updates');assert.equal(bridges.length,cachedUpdateCalls,'Fresh saved metadata suppresses checks across service idle exits');
assert.equal(elements['release-notes'].textContent,'<script>plain notes</script>');assert.match(elements['install-guide'].textContent,/Dev Manager/);assert.match(elements['checksum-guide'].textContent,/not.*signature/i);
advance(21600001);click('check-updates');updateReply('0.7.5');assert.match(elements['update-status'].textContent,/newer.*stable/i);
advance(21600001);click('check-updates');updateReply(appVersion);assert.match(elements['update-status'].textContent,/current/i);
advance(21600001);click('check-updates');updateReply('0.9.0',{url:'https://evil.test/updates'});assert.match(elements['update-status'].textContent,/unavailable/i);assert.ok(!elements['release-url'].textContent.includes('evil'));
advance(60001);click('check-updates');const obsoleteUpdate=bridges.at(-1);key(461);assert.equal(obsoleteUpdate.cancelled,true);obsoleteUpdate.onservicecallback(JSON.stringify({returnValue:true,release:{version:'99.0.0'}}));assert.equal(elements.home.hidden,false);click('about-button');assert.equal(elements['check-updates'].disabled,false,'Cancelled check can be retried after reopening About');
boot(updateStore,'ok','en-US',false,clock);click('about-button');assert(elements['latest-version'].textContent.includes(appVersion));const offlineUpdates=bridges.length;click('check-updates');assert.equal(bridges.length,offlineUpdates);assert.match(elements['update-status'].textContent,/unavailable/i);
navigator.onLine=true;click('check-updates');bridges.at(-1).onservicecallback(JSON.stringify({returnValue:false,retryAt:clock+21600000}));
boot(updateStore,'ok','en-US',true,clock+6001);click('about-button');click('check-updates');assert.equal(bridges.length,0,'Rate-limit backoff survives app/service recreation');
console.log('Updates UI: passed (viewer initiation, semantic status, safe notes/links, offline cache and cancellation).');

// Accessibility preferences persist, survive unavailable storage and retain remote focus.
const accessibleStore={data:{},getItem(k){return this.data[k]||null;},setItem(k,v){this.data[k]=v;}};
boot(accessibleStore,'ok','en-US');click('accessibility-button');click('text-size');click('high-contrast');
assert.equal(document.documentElement.attrs['data-text-size'],'large');assert.equal(document.documentElement.attrs['data-contrast'],'high');
assert.equal(elements['high-contrast'].attrs['aria-pressed'],'true');key(461);assert.equal(document.activeElement,elements['accessibility-button']);
boot(accessibleStore,'ok','en-US');assert.equal(document.documentElement.attrs['data-text-size'],'large');assert.equal(document.documentElement.attrs['data-contrast'],'high');
submit('example');respond({live:null,videos:Array.from({length:6},(_,i)=>({...vod,id:'accessible-'+i,title:'Record '+i}))});
elements.videos.firstChild.focus();key(40);assert.equal(document.activeElement,elements.videos.children[2],'Large-text grid navigation follows two columns');key(461);
click('accessibility-button');click('accessibility-reset');assert.equal(document.documentElement.attrs['data-text-size'],'normal');assert.equal(document.documentElement.attrs['data-contrast'],'normal');
elements['accessibility-close'].focus();key(9);assert.equal(document.activeElement,elements['text-size']);
document.hidden=true;document.handlers.visibilitychange();assert.equal(elements['accessibility-dialog'].hidden,true);
boot({getItem(){throw Error('Denied');},setItem(){throw Error('Full');}},'ok','en-US');click('accessibility-button');click('text-size');assert.equal(document.documentElement.attrs['data-text-size'],'large');
assert.equal(elements['playback-status'].attrs['aria-live'],'polite');assert.equal(elements['playback-status'].attrs['aria-atomic'],'true');
console.log('Accessibility: passed (bounded persistence, reset, remote focus, grid columns, lifecycle and denied storage).');

// A new replay selection offers saved progress; dismissing it never mounts media.
const resumeData=new Map([['kick-watched-videos',JSON.stringify([{key:'returner:resume-a',position:123,duration:600,finished:false}])]]);
const resumeStorage={getItem:k=>resumeData.get(k)||null,setItem:(k,v)=>resumeData.set(k,v)};
const resumeReplay={...vod,id:'resume-a'};
boot(resumeStorage);submit('returner');respond({live:null,videos:[resumeReplay]});
elements.videos.firstChild.handlers.click();
assert.equal(elements['resume-choice']?.hidden,false,'Saved replay offers Continue and Start over');
assert.equal(videoSource(),undefined,'A choice never starts a decoder implicitly');
key(9);assert.equal(document.activeElement,elements['resume-start'],'Tab stays inside the choice');
key(9);key(9);assert.equal(document.activeElement,elements['resume-continue']);
key(9,{shiftKey:true});assert.equal(document.activeElement,elements['resume-cancel']);
click('resume-continue');qualityResponse();ready();
assert.equal(options().option.transmission.playTime.start,123000,'Resume uses native start time, not an overlapping early seek');
click('watch-recordings');elements.videos.firstChild.handlers.click();click('resume-start');qualityResponse();ready();
assert.equal(options().option.transmission,undefined,'Start over explicitly ignores saved progress');
click('back');

// Continue watching renders one page and owns at most two metadata requests.
const shelfData=new Map([['kick-watched-videos',JSON.stringify(Array.from({length:15},(_,i)=>({key:'shelf:r'+i,position:100,duration:600,finished:false})))]]);
const shelfStorage={getItem:k=>shelfData.get(k)||null,setItem:(k,v)=>shelfData.set(k,v)};
boot(shelfStorage);assert.equal(elements['continue-list'].children.length,6);
const shelfRequests=()=>bridges.filter(b=>b.uri.endsWith('/replay'));
assert.equal(shelfRequests().length,2,'Only two visible-page metadata workers start');
assert.ok(shelfRequests().every(b=>b.payload.background===true),'Only shelf lookups use background capacity');
const firstMetadata=shelfRequests()[0].onservicecallback;
firstMetadata(JSON.stringify({returnValue:true,video:{...vod,id:'r0',title:'Fresh replay'}}));
assert.equal(shelfRequests().length,3);assert.match(elements['continue-list'].firstChild.firstChild.textContent,/Fresh replay/);
firstMetadata(JSON.stringify({returnValue:true,video:{...vod,id:'r0'}}));
assert.equal(shelfRequests().length,3,'A repeated callback cannot create a third metadata worker');
const obsoleteMetadata=shelfRequests().at(-1).onservicecallback;
submit('other');const afterLeaving=shelfRequests().length;obsoleteMetadata(JSON.stringify({returnValue:true,video:{...vod,id:'r2'}}));
assert.equal(shelfRequests().length,afterLeaving,'Leaving home cancels the metadata queue');
assert.ok(shelfRequests().every(b=>b.cancelled));
respond({live:null});click('catalog-back');click('continue-next');assert.equal(elements['continue-number'].textContent,'2 / 3');
elements['continue-list'].firstChild.children[1].handlers.click();
assert.equal(JSON.parse(shelfData.get('kick-watched-videos')).length,14,'Unavailable entries can be removed without mounting a player');
assert.ok(JSON.parse(shelfData.get('kick-watched-videos')).every(e=>Object.keys(e).sort().join(',')==='duration,finished,key,position'));
// Completed/near-end history never offers a resume that immediately ends again.
for(const entry of [{position:580,finished:false},{position:123,finished:true}]){
 const d=new Map([['kick-watched-videos',JSON.stringify([{key:'returner:resume-a',duration:600,...entry}])]]);
 boot({getItem:k=>d.get(k)||null,setItem:(k,v)=>d.set(k,v)});assert.equal(elements['continue-section'].hidden,true);
 submit('returner');respond({live:null,videos:[resumeReplay]},false);elements.videos.firstChild.handlers.click();
 assert.equal(elements['resume-choice'].hidden,true);qualityResponse();ready();assert.equal(options().option.transmission,undefined);
 if(entry.finished){progressAt(2);click('toggle');assert.equal(JSON.parse(d.get('kick-watched-videos'))[0].finished,false,'Starting a finished replay makes new progress resumable');}
 click('back');
}
// A dismissed choice and a stale home lookup never start playback.
boot(resumeStorage);const oldShelf=bridges.find(b=>b.uri.endsWith('/replay')).onservicecallback;
submit('returner');respond({live:null,videos:[resumeReplay]},false);elements.videos.firstChild.focus();elements.videos.firstChild.handlers.click();
key(461);assert.equal(elements['resume-choice'].hidden,true);assert.equal(document.activeElement,elements.videos.firstChild);
assert.equal(videoSource(),undefined);oldShelf(JSON.stringify({returnValue:true,video:resumeReplay}));assert.equal(videoSource(),undefined);
// The shelf is reachable vertically and refreshes after offline startup.
const withRecents={getItem:k=>k==='kick-recent-channels'?'["returner"]':resumeStorage.getItem(k),setItem:resumeStorage.setItem};
boot(withRecents);elements['recent-channels'].firstChild.firstChild.focus();key(40);
assert.equal(document.activeElement,elements['about-button'],'Down leaves the last recent row for the fixed footer');
elements['recent-channels'].firstChild.children[2].focus();key(39);assert.equal(document.activeElement,elements['continue-list'].firstChild.firstChild,'Right crosses to the adjacent populated column');
boot(resumeStorage,'ok','cs-CZ',false);assert.equal(bridges.filter(b=>b.uri.endsWith('/replay')).length,0);
navigator.onLine=true;window.handlers.online();assert.equal(bridges.filter(b=>b.uri.endsWith('/replay')).length,1,'Online refreshes visible shelf metadata');
// Opening history resolves the selected public identity beyond the visible catalogue.
boot(resumeStorage);elements['continue-list'].firstChild.firstChild.handlers.click();
respond({live:null,videos:[]},false);assert.ok(bridges.at(-1).uri.endsWith('/replay'));
bridges.at(-1).onservicecallback(JSON.stringify({returnValue:true,video:{...resumeReplay,url:vod.url+'?token=fresh'}}));
assert.equal(elements['resume-choice'].hidden,false);click('resume-continue');qualityResponse();ready();
assert.equal(videoSource(),vod.url+'?token=fresh');assert.equal(options().option.transmission.playTime.start,123000);
click('back');
// Explicit selection wins over an older in-flight history lookup.
const raceHistory=[{key:'returner:resume-a',position:123,duration:600,finished:false},{key:'returner:saved-f',position:222,duration:600,finished:false}];
boot({getItem:k=>k==='kick-watched-videos'?JSON.stringify(raceHistory):null,setItem(){}});
elements['continue-list'].firstChild.firstChild.handlers.click();
const selectedReplay={...vod,id:'saved-f',title:'Chosen F',url:'https://stream.kick.com/f/master.m3u8'};
respond({live:null,videos:[selectedReplay]},false);const oldSelection=bridges.at(-1).onservicecallback;
elements.videos.firstChild.handlers.click();oldSelection(JSON.stringify({returnValue:true,video:{...resumeReplay,title:'Original E'}}));
assert.equal(elements['resume-info'].textContent,'Chosen F','An obsolete lookup cannot replace an explicit choice');
click('resume-continue');qualityResponse();ready();assert.equal(videoSource(),selectedReplay.url);assert.equal(options().option.transmission.playTime.start,222000);click('back');
console.log('Continue watching: passed (resume/start-over, page bounds, worker bounds, cancellation and history removal).');

// Replay history follows actual media progress, survives restarts, and never stores signed URLs.
const historyKey='kick-watched-videos', historyData=new Map();let historyWrites=0;
const historyStorage={getItem:k=>historyData.get(k)||null,setItem(k,v){if(k===historyKey)historyWrites++;historyData.set(k,v);}};
const replayA={...vod,id:'replay-a'}, replayB={...vod,id:'replay-b',url:'https://stream.kick.com/b/master.m3u8'};
function openReplay(index=0){elements.videos.children[index].handlers.click();if(elements['resume-choice']&&!elements['resume-choice'].hidden)click('resume-start');qualityResponse();ready();}
function progressAt(seconds){node()._time=seconds;node().handlers.timeupdate();}
function history(){return JSON.parse(historyData.get(historyKey)||'[]');}
function replayBadge(index,cls){return elements.videos.children[index].firstChild.children.find(c=>c.className===cls);}
boot(historyStorage);submit('astatoro');respond({live:null,videos:[replayA,replayB]});
openReplay();assert.equal(history().length,0,'Loading and playing events alone are not viewing');
click('toggle');elements.seek.value=150;elements.seek.handlers.change();advance(300);seeked();progressAt(150);
assert.equal(history().length,0,'A paused seek does not mark the recording as seen');
click('toggle');progressAt(150.25);assert.equal(history()[0].position,150.25);
assert.equal(history()[0].key,'astatoro:replay-a');assert.equal(historyWrites,1);
advance(3000);progressAt(153.25);assert.equal(historyWrites,1,'Do not write storage on every timeupdate');
click('toggle');assert.equal(history()[0].position,153.25,'Pause flushes the latest played position');
const previousReplay=node(), oldProgress=previousReplay.handlers.timeupdate;exitWatch();
assert.equal(replayBadge(0,'last-watched').textContent,'Naposledy sledované');
assert.equal(replayBadge(0,'watched-badge').textContent,'Sledováno · 2:33');
assert.match(elements.videos.firstChild.attrs['aria-label'],/Naposledy sledované, Sledováno/);
assert.equal(replayBadge(1,'watched-badge'),undefined);
openReplay(1);node().handlers.error();exitWatch();
assert.equal(replayBadge(1,'watched-badge'),undefined,'A failed start is not viewing');
openReplay(1);progressAt(2);advance(1000);progressAt(3);window.handlers.pagehide();
assert.equal(history()[0].key,'astatoro:replay-b');assert.equal(history()[0].position,3);
oldProgress();assert.equal(history()[0].key,'astatoro:replay-b','Old decoder events cannot reorder history');
assert.ok(history().every(h=>Object.keys(h).sort().join(',')==='duration,finished,key,position'));
boot(historyStorage);submit('astatoro');respond({live:null,videos:[{...replayA,url:replayA.url+'?token=changed'},replayB]});
assert.equal(replayBadge(0,'watched-badge').textContent,'Sledováno · 2:33','Stable IDs survive refreshed stream URLs');
assert.equal(replayBadge(0,'last-watched'),undefined);assert.ok(replayBadge(1,'last-watched'));
openReplay();progressAt(1);node().handlers.ended();exitWatch();
assert.equal(replayBadge(0,'watched-badge').textContent,'Zhlédnuto');
assert.equal(replayBadge(0,'watched-progress').value,replayBadge(0,'watched-progress').max);
assert.ok(replayBadge(0,'last-watched'));assert.equal(replayBadge(1,'last-watched'),undefined);
click('catalog-back');submit('another');respond({live:null,videos:[replayA]});
assert.equal(replayBadge(0,'watched-badge'),undefined,'Replay identity includes its channel');
click('catalog-back');submit('astatoro');respond({videos:[replayA],live});progressAt(3);exitWatch();
assert.equal(history()[0].key,'astatoro:replay-a','LIVE does not change replay history');
for(const invalid of ['{broken','null','{}','x'.repeat(100001),JSON.stringify([null,{key:'astatoro:replay-a',position:'1',duration:300,finished:false}])]){
 historyData.set(historyKey,invalid);boot(historyStorage);submit('astatoro');respond({live:null,videos:[replayA]});
 assert.equal(replayBadge(0,'watched-badge'),undefined);
 openReplay();node().handlers.ended();assert.equal(replayBadge(0,'watched-badge'),undefined);
 progressAt(1);exitWatch();assert.equal(replayBadge(0,'watched-badge'),undefined,'Ended without any playback never marks viewed');
}
historyData.set(historyKey,JSON.stringify(Array.from({length:220},(_,i)=>({key:'astatoro:old-'+i,position:10,duration:300,finished:false}))));
boot(historyStorage);submit('astatoro');respond({live:null,videos:[replayA]});openReplay();progressAt(1);
assert.equal(history().length,200);assert.equal(history()[0].key,'astatoro:replay-a');assert.equal(history().at(-1).key,'astatoro:old-198');
boot({getItem(){throw Error('Denied');},setItem(){throw Error('Quota');}});
submit('astatoro');respond({live:null,videos:[replayA]});openReplay();progressAt(2);document.hidden=true;document.handlers.visibilitychange();
document.hidden=false;document.handlers.visibilitychange();exitWatch();assert.ok(replayBadge(0,'watched-badge'),'Storage failure preserves this session without crashing');
console.log('Replay history: passed (actual progress, stable IDs, last-viewed badges, completion, restarts, bounded storage and storage failures).');
boot();submit('astatoro');respond({live:null,videos:[{...vod,title:'x'.repeat(199)+'🔴tail'}]});
assert.equal(elements.videos.firstChild.children[1].textContent,'x'.repeat(199)+'🔴','UI title limits preserve complete emoji');
const symbolTitle='🔴ONE🔴TWO🔴 👩🏽‍💻 🇨🇿 🪖Kdo mi bude krýt záda? 778-037 🫡 <img src=x>';
click('catalog-back');submit('astatoro');respond({live:null,videos:[{...vod,title:symbolTitle}]});
const renderedTitle=elements.videos.firstChild.children[1];
assert.equal(renderedTitle.textContent,symbolTitle,'Untrusted titles stay plain text');
assert.deepEqual(renderedTitle.children.filter(c=>c.className==='title-symbol').map(c=>c.textContent),['🔴','🔴','🔴','👩🏽‍💻','🇨🇿','🪖','🫡']);
assert.ok(renderedTitle.children.filter(c=>!c.className).some(c=>c.textContent.includes('778-037 ')),'Text and spaces must stay outside emoji spans');
openReplay();assert.equal(elements['video-title'].textContent,symbolTitle,'Catalog and player use the same symbol rendering');
// The pinned font has locally verified helmet/saluting-face glyphs; retain it in every IPK.
const emojiFont=fs.readFileSync('app/fonts/NotoEmoji-Regular.woff2');
assert.equal(require('node:crypto').createHash('sha256').update(emojiFont).digest('hex'),'72149441d478acb7e5e4fe27adbabde4330f86affed8b3301e4bc4c4d92d53c1');
assert.match(fs.readFileSync('app/fonts/OFL.txt','utf8'),/SIL OPEN FONT LICENSE Version 1.1/);
const css=fs.readFileSync('app/style.css','utf8');
assert.match(css,/\.title-symbol\s*\{[^}]*font-family:[^}]*"Kick Emoji"/);
assert.doesNotMatch(css.match(/body, input, button\s*\{[^}]*\}/)[0],/Emoji/,'Body text must keep its original font metrics');
function fontCovers(family, cp) {
  const face=css.match(/@font-face\s*\{[^}]+\}/g).find(f=>f.includes('"'+family+'"'));
  return face.match(/unicode-range:([^;]+)/)[1].split(',').some(range=>{
    const [start,end]=range.trim().slice(2).split('-').map(n=>parseInt(n,16));
    return cp>=start&&cp<=(end??start);
  });
}
for(let cp=32;cp<127;cp++)assert.equal(fontCovers('Kick Emoji',cp),false,'Ordinary ASCII cannot pick up emoji font metrics');
assert.match(css,/\.title-keycap\s*\{[^}]*"Kick Keycap"/);
for(const cp of [0x23,0x2a,0x31,0x20e3,0xfe0f])assert.ok(fontCovers('Kick Keycap',cp));
assert.match(fs.readFileSync('app/index.html','utf8'),/font-src 'self' file:/,'Packaged local fonts must be allowed by CSP');
// Distinct emoji from 681 public LIVE/replay titles across 35 channels (2026-09-12).
const sampledSymbols=['⚔️','⚠️','⛽','✍️','❌','❣️','🇲🇹','🌊','🌍','🌎','🌞','🌴','🍂','🍦','🍷','🎒','🎓',
 '🏙️','🐌','🐕','🐟','🐠','🐳','👁️','👄','👈','👐','👓','👹','👺','👾','💀','💈','💗','💬','💰','💼',
 '🔥','🔪','🔴','🖌','🖱️','😇','😈','😱','🚀','🚗','🚘','🚬','🛑','🤖','🤗','🤤','🥂','🥡','🥰','🥳',
 '🥵','🥶','🦒','🦲','🧀','🧠','🧡','🧳','🪖','🫡','🫦'];
const compoundSymbols=['❤️‍🔥','🏴‍☠️','✍🏽','👩🏽‍💻','1️⃣','#️⃣','*️⃣','🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];
boot();
for(const symbol of sampledSymbols.concat(compoundSymbols)){
 const title='Český text ¿Qué? 778-037 # * 123 '+symbol+' / '+symbol;
 submit('example');respond({live:null,videos:[{...vod,title}]});
 function checkSymbols(node){
  assert.equal(node.textContent,title);
  const spans=node.children.filter(c=>(c.className||'').split(' ').includes('title-symbol'));
  assert.deepEqual(spans.map(c=>c.textContent),[symbol,symbol],'Keep each repeated emoji sequence intact: '+symbol);
  assert.ok(!node.children[0].className,'Ordinary text, digits and spaces keep the text font');
  const keycap=/^[#*0-9]/.test(symbol);
  for(const span of spans)assert.equal(span.className.includes('title-keycap'),keycap);
  for(const c of symbol)assert.ok(fontCovers(keycap?'Kick Keycap':'Kick Emoji',c.codePointAt(0)),'Fallback CSS covers '+symbol);
 }
 checkSymbols(elements.videos.firstChild.children[1]);
 openReplay();checkSymbols(elements['video-title']);exitWatch();click('catalog-back');
}
console.log('Title symbols: passed (68 sampled sequences, 8 compound cases, catalog/player isolation and ordinary text spacing).');
const performanceReplays=Array.from({length:30},(_,i)=>({...vod,id:'perf-'+i,thumbnail:'https://files.kick.com/'+i+'.jpg'}));
boot();submit('example');respond({live:null,videos:performanceReplays});
assert.equal(created.img,6,'Render only the six visible thumbnails, once per catalog load');
const perfImages=created.img;
click('catalog-back');
assert.equal(elements.videos.children.length,0,'Returning home releases hidden replay cards and their thumbnail references');
submit('example');respond({live:null,videos:performanceReplays});
assert.equal(elements.videos.children.length,6,'Opening the channel again renders a fresh catalog');
boot();submit('example');respond({videos:performanceReplays});
assert.equal(created.img||0,0,'Autoplay must not construct a hidden catalog');
click('watch-recordings');assert.equal(created.img,6);
openReplay();
const beforeTimeWrites=textWrites.elapsed||0,beforeToggleWrites=textWrites.toggle||0;
for(let i=1;i<=240;i++){node()._time=i/4;node().handlers.timeupdate();}
const timelineWrites=textWrites.elapsed-beforeTimeWrites,toggleWrites=textWrites.toggle-beforeToggleWrites;
assert.ok(timelineWrites<=60,'Timeline text changes at most once per second during continuous playback');
assert.equal(toggleWrites,0,'Steady playback never rewrites the pause label');
assert.equal(elements.elapsed.textContent,'1:00');
assert.equal(elements['seek-progress'].value,60);
click('toggle');assert.equal(elements.toggle.textContent,'Pokračovat','Transitions update immediately');
for(const [width,columns] of [[560,1],[800,2],[1280,3]]){
 boot();window.innerWidth=width;submit('example');respond({live:null,videos:performanceReplays});
 elements.videos.firstChild.focus();key(40);assert.equal(document.activeElement,elements.videos.children[columns]);
}
boot({getItem(key){return key==='kick-recent-channels'?'["'+'x'.repeat(4096)+'"]':null;},setItem(){}});
assert.deepEqual(names(),[],'Oversized recent history is ignored');
submit('example');bridges.at(-1).onservicecallback(' '.repeat(1048577));
assert.match(elements['channel-status'].textContent,/neplatnou/,'Oversized bridge payload fails visibly');
boot();submit('example');respond();
const timerBaseline=timerAllocations;
for(let i=1;i<=240;i++){advance(250);node()._time=i/4;node().handlers.timeupdate();}
const playbackTimers=timerAllocations-timerBaseline;
assert.ok(playbackTimers<=5,'Steady playback schedules at most five timers per minute, not one per media event: '+playbackTimers);
advance(19999);assert.ok(node(),'The watchdog waits twenty seconds after the last progress update');
advance(1);assert.equal(node(),undefined,'The coalesced watchdog still detects a twenty-second stall');
click('back');
boot();submit('example');respond();advance(10000);wallClockOffset=-3600000;
advance(9999);assert.ok(node());advance(1);
assert.equal(node(),undefined,'A TV wall-clock correction cannot postpone the stall watchdog');
click('back');
console.log('Performance budgets: '+JSON.stringify({catalogThumbnails:perfImages,timelineTextWritesPerMinute:timelineWrites,pauseLabelWritesDuringPlayback:toggleWrites,playbackTimersPerMinute:playbackTimers}));

// Recent channels: page-local status requests, removal, persistence and stale callbacks.
const recentStore=new Map([['kick-recent-channels',JSON.stringify(Array.from({length:50},(_,i)=>'saved-'+i))],['kick-channel','legacy']]);
const recentStorage={getItem:k=>recentStore.get(k)||null,setItem:(k,v)=>recentStore.set(k,v)};
const recentRow=i=>elements['recent-channels'].children[i];
const statusReply=(bridge,live)=>bridge.onservicecallback(JSON.stringify({returnValue:true,statuses:bridge.payload.channels.map(channel=>({channel,live}))}));
boot(recentStorage);
assert.equal(names().length,6);assert.equal(elements['recent-page-number'].textContent,'1 / 9');
assert.equal(bridges[0].payload.channels.length,6);assert.match(bridges[0].uri,/statuses$/);
const obsoleteStatus=bridges[0];click('recent-next');assert.equal(obsoleteStatus.cancelled,true);
statusReply(obsoleteStatus,true);assert.equal(recentRow(0).firstChild.children[1].hidden,true);
statusReply(bridges.at(-1),true);assert.equal(recentRow(0).firstChild.children[1].hidden,false);
assert.match(recentRow(0).firstChild.attrs['aria-label'],/právě vysílá/);
recentRow(0).firstChild.focus();key(39);assert.equal(document.activeElement,recentRow(0).children[1]);
key(40);assert.equal(document.activeElement,recentRow(1).children[1]);
recentRow(0).children[2].handlers.click();assert.equal(names()[0],'saved-7');
assert.equal(JSON.parse(recentStore.get('kick-recent-channels')).includes('saved-6'),false);
assert.equal(document.activeElement,recentRow(0).firstChild);
advance(60000);assert.equal(recentRow(0).firstChild.children[1].hidden,true,'Expired status is hidden while refreshing');
statusReply(bridges.at(-1),false);assert.equal(recentRow(0).firstChild.children[1].hidden,true);
click('recent-previous');const pendingStatus=bridges.at(-1);submit('new-channel');
assert.equal(pendingStatus.cancelled,true);respond({live:null});
assert.equal(JSON.parse(recentStore.get('kick-recent-channels')).length,50);
click('catalog-back');submit('newer-channel');respond({live:null});
assert.equal(JSON.parse(recentStore.get('kick-recent-channels')).length,50);
boot(recentStorage);assert.equal(names()[0],'newer-channel');
for(let i=0;i<8;i++)click('recent-next');
assert.equal(names().length,2);recentRow(1).children[2].handlers.click();recentRow(0).children[2].handlers.click();
assert.equal(elements['recent-page-number'].textContent,'8 / 8','Deleting the final row clamps the page');
recentStore.set('kick-recent-channels','["only"]');boot(recentStorage);
recentRow(0).children[2].handlers.click();assert.equal(elements.recent.hidden,true);assert.equal(document.activeElement,elements.channel);
boot(recentStorage);assert.deepEqual(names(),[],'Deleted channels are not restored by legacy migration');
recentStore.set('kick-recent-channels','["only"]');boot(recentStorage);
bridges.at(-1).onservicecallback('x'.repeat(4097));assert.equal(recentRow(0).firstChild.children[1].hidden,true);
advance(60000);const timeoutStatus=bridges.at(-1);advance(40000);assert.equal(timeoutStatus.cancelled,true);
document.hidden=true;document.handlers.visibilitychange();const hiddenRequests=bridges.length;
advance(120000);assert.equal(bridges.length,hiddenRequests,'No background status polling while hidden');
console.log('Recent channels: passed (50 stored, six per page, LIVE status, expiry, cancellation, removal and restart).');

// UI language follows the TV locale; every language covers every key with identical placeholders.
const i18n=require('./app/i18n.js');
const baseKeys=Object.keys(i18n.strings.en).sort();
const placeholders=text=>(text.match(/\{[a-z]+\}/g)||[]).sort();
assert.ok(i18n.languages.length>=13&&i18n.languages.includes('cs')&&i18n.languages.includes('en'));
for(const lang of i18n.languages){
 assert.deepEqual(Object.keys(i18n.strings[lang]).sort(),baseKeys,lang+' must translate every key');
 for(const key of baseKeys){
  const text=i18n.strings[lang][key];
  assert.ok(typeof text==='string'&&text.length>0&&text.length<=200,lang+'.'+key);
  assert.deepEqual(placeholders(text),placeholders(i18n.strings.en[key]),lang+'.'+key+' placeholders');
  assert.doesNotMatch(text,/[<>]/,'Translations never carry markup');
 }
 const resource=JSON.parse(fs.readFileSync('app/resources/'+lang+'/appinfo.json','utf8'));
 assert.deepEqual(resource,{title:i18n.strings[lang].title,appDescription:i18n.strings[lang].footer_note},'Launcher title for '+lang);
}
assert.equal(fs.readdirSync('app/resources').sort().join(),[...i18n.languages].sort().join(),'No stray launcher resources');
const appinfo=JSON.parse(fs.readFileSync('app/appinfo.json','utf8'));
assert.equal(appinfo.title,i18n.strings.en.title);assert.equal(appinfo.appDescription,i18n.strings.en.footer_note);
assert.equal(JSON.parse(fs.readFileSync('package.json','utf8')).version,appVersion);
assert.equal(JSON.parse(fs.readFileSync('service/package.json','utf8')).version,appVersion,'App, service and package versions stay in step');
// Markup declares its keys; the English defaults in index.html must match the dictionary so the HTML never drifts.
const html=fs.readFileSync('app/index.html','utf8');let labelledCount=0;
for(const [,tag,inner] of html.matchAll(/(<[a-z0-9]+\s[^>]*>)([^<]*)/g)){
 const attrs=Object.fromEntries([...tag.matchAll(/([a-z0-9-]+)="([^"]*)"/g)].map(([,n,v])=>[n,v]));
 if(attrs['data-i18n']){labelledCount++;assert.ok(baseKeys.includes(attrs['data-i18n']),attrs['data-i18n']);
  assert.equal(inner.replace(/&nbsp;/g,'\u00A0'),i18n.strings.en[attrs['data-i18n']],'HTML default for '+attrs['data-i18n']);}
 if(attrs['data-i18n-attr'])for(const pair of attrs['data-i18n-attr'].split(';')){labelledCount++;const [name,key]=pair.split(':');
  assert.ok(baseKeys.includes(key),key);assert.equal(attrs[name],i18n.strings.en[key],'HTML default attribute '+name+' for '+key);}
}
assert.ok(labelledCount>=28,'Static labels are declared in markup');
for(const [candidates,expected] of [[['cs-CZ'],'cs'],[['sk_SK'],'sk'],[['SK'],'sk'],[['pt-BR'],'pt'],[['zh-Hans-CN','de-AT'],'de'],[['xx'],'en'],[[null,42,{}],'en'],[['a'.repeat(40)],'en'],[[],'en'],[['en-GB','cs'],'en'],[['tr-TR'],'tr'],[['uk'],'uk']])
 assert.equal(i18n.language(candidates),expected,JSON.stringify(candidates));
assert.equal(i18n.detect({webOSSystem:{locale:'de-DE'},navigator:{language:'cs'}}),'de','webOS locale wins');
assert.equal(i18n.detect({PalmSystem:{locale:'sk-SK'},navigator:{language:'cs'}}),'sk');
assert.equal(i18n.detect({navigator:{language:'xx',languages:['yy','pl-PL']}}),'pl');
assert.equal(i18n.detect({}),'en');assert.equal(i18n.detect({get webOSSystem(){throw Error('denied');}}),'en');
const cs=i18n.translator('cs');
assert.equal(cs('p_media_error',{code:3}),'TV nemůže přehrát video (chyba 3).');
assert.equal(cs('svc_http',{}),'Kick API: HTTP {status}');assert.equal(cs('missing_key'),'missing_key');
assert.equal(i18n.translator('xx')('retry'),'Try again');assert.equal(i18n.translator('xx').language,'xx');
boot(storage,'ok','en-US');
assert.equal(elements.heading.textContent,'What will you watch?');assert.equal(elements.channel.attrs.placeholder,'Channel name or kick.com/… link');
assert.equal(elements['play-label'].textContent,'Play live');assert.equal(elements['live-label'].textContent,'Play live');
assert.equal(elements.seek.attrs['aria-label'],'Replay position');assert.equal(elements.toggle.textContent,'Pause');
assert.equal(document.title,'Stream for Kick');
submit('example');respond({live:null,videos:[{...vod,title:''}],videosError:{errorCode:'videos_unavailable',errorParams:{},errorText:'x'}});
assert.equal(elements['channel-status'].textContent,'Offline · Choose one of the replays.');
assert.equal(elements['videos-status'].textContent,'The replay list is not available.');assert.equal(elements['catalog-retry'].hidden,false);
assert.equal(elements.videos.firstChild.children[1].textContent,'Replay','Empty titles use the localized fallback');
assert.match(elements.videos.firstChild.children[2].textContent,/0 h 10 min/);
elements.videos.firstChild.handlers.click();qualityResponse();ready();
assert.equal(elements.quality.textContent,'Highest available: 1080p · 60 fps');
node().handlers.ended();assert.equal(elements['playback-status'].textContent,'The replay has ended. Choose another.');
assert.equal(elements.toggle.textContent,'Resume');
click('toggle');ready();node().error={code:3};node().handlers.error();advance(600);node().error={code:3};node().handlers.error();advance(600);
node().error={code:3};node().handlers.error();advance(600);
assert.equal(elements['playback-status'].textContent,'The TV cannot play this video (error 3). Select Try again or another replay.');
assert.equal(elements.toggle.textContent,'Try again');
click('back');
for(const [reply,expected] of [[{errorCode:'http',errorParams:{status:403},errorText:'Kick API: HTTP 403'},'Kick API: HTTP 403'],
 [{errorCode:'busy',errorText:'x'},'Another download is in progress. Try again in a moment.'],
 [{errorCode:'<script>',errorText:'y'.repeat(500)},'y'.repeat(200)],
 [{errorCode:'not_a_key',errorText:''},'The channel could not be loaded. Try again.'],
 [{errorCode:'http',errorParams:{status:'<b>'.repeat(40)},errorText:''},'Kick API: HTTP {status}'],
 [{errorCode:'http',errorParams:{status:{}},errorText:''},'Kick API: HTTP {status}'],
 [{errorCode:'internal',errorParams:{},errorText:'raw engine text'},'The data from Kick could not be processed.']]){
 submit('failed');respond({returnValue:false,...reply});assert.equal(elements['channel-status'].textContent,expected);click('catalog-back');
}
navigator.onLine=false;submit('example');assert.equal(elements.error.textContent,'The TV is not connected to the internet. Check the connection.');navigator.onLine=true;
submit('example');respond({live:null,videos:[],videosError:'legacy string'});assert.equal(elements['videos-status'].textContent,'This channel has no public replays.','Only object-shaped replay errors are rendered');click('catalog-back');
assert.equal(elements.pages.attrs['aria-label'],'Replay pages');assert.equal(elements['videos-heading'].textContent,'Stream replays');
boot(storage,'ok','sk-SK');assert.equal(elements.heading.textContent,'Čo si pustíš?');
submit('failed');respond({returnValue:false,errorCode:'timeout',errorText:'late'});assert.equal(elements['channel-status'].textContent,'Kick neodpovedal včas. Skúste to znova.');
boot(storage,'ok','tlh');assert.equal(elements.heading.textContent,'What will you watch?','Unsupported TV languages fall back to English');
boot(storage,'ok',null);assert.equal(elements.heading.textContent,'What will you watch?','No locale source still renders');
boot(storage,'missing','fr-FR');submit('example');assert.equal(elements['channel-status'].textContent,'La lecture nécessite l’installation de l’application avec son service sur le téléviseur.');
boot();assert.equal(elements.heading.textContent,'Co si pustíš?');
console.log('Localization: passed ('+i18n.languages.length+' languages, key coverage, placeholder parity, locale detection, launcher resources, service error codes).');

async function testService() {
  const {EventEmitter}=require('node:events');
  let serviceNow=1000000, releases=[], latestRelease=null;
  let handlers={}, calls=[], replies=[], status=200, transport='ok', waiting=[], aborted=0, agents=[], resets={};
  const settle=async(condition)=>{const until=Date.now()+5000;while(!condition()&&Date.now()<until)await new Promise(r=>setImmediate(r));assert.ok(condition(),'Reply arrived');};
  const gzip=text=>require('node:zlib').gzipSync(Buffer.from(text,'utf8'));
  const serviceTimers=new Map();
  const responseData={slug:'example',playback_url:live.url,livestream:{is_live:true,session_title:'Live'}};
  const good={is_live:false,source:vod.url,session_title:'Public',duration:60000,thumbnail:{src:'https://files.kick.com/test.jpg'},video:{uuid:'fd0d9069-63ca-42b2-b7b9-4d23134506b1',is_private:false,status:'public'}};
  let recordings=[good,{...good,video:{is_private:true,status:'public'}},{...good,is_live:true},{...good,source:'https://evil.test/x.m3u8'},{...good,video:{is_private:false,status:'public',deleted_at:'now'}}];
  let playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080,FRAME-RATE=60\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=18000000,RESOLUTION=3840x2160,FRAME-RATE=30\n4k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=11000000,RESOLUTION=2560x1440,FRAME-RATE=60\n1440.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=90000000,RESOLUTION=7680x4320\n8k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000\naudio.m3u8';
  const https={get(options, callback){
    calls.push(options);
    assert.ok(/^[a-z0-9.-]+$/.test(options.hostname)&&options.path.startsWith('/'),'Host and path are split safely');
    const req=new EventEmitter();req.abort=()=>{aborted++;};
    const deliver=()=>{
      const resetCount=resets[options.path]||0;
      if(transport==='reset-once'&&resetCount<1||transport==='reset-twice'&&resetCount<2){resets[options.path]=resetCount+1;const e=Error('socket hang up');e.code='ECONNRESET';req.emit('error',e);return;}
      const res=new EventEmitter();res.statusCode=status;res.resume=()=>{};res.setEncoding=()=>{};res.headers={};
      res.pipe=dest=>{res.on('data',c=>dest.write(c));res.on('end',()=>dest.end());return dest;};
      if(transport.startsWith('gzip'))res.headers['content-encoding']='gzip';
      if(transport==='unsupported-encoding')res.headers['content-encoding']='br';
      callback(res);
      if(transport==='gzip'){const packed=gzip(JSON.stringify(options.path.endsWith('/videos')?recordings:responseData));res.emit('data',packed.subarray(0,5));res.emit('data',packed.subarray(5));res.emit('end');return;}
      if(transport==='gzip-large'){res.emit('data',gzip(' '.repeat(2097152)));res.emit('end');return;}
      if(transport==='gzip-bad'){res.emit('data',Buffer.from('not gzip at all'));res.emit('end');return;}
      if(transport==='unsupported-encoding'){res.emit('data','{}');res.emit('end');return;}
      if(transport==='aborted'){res.emit('aborted');return;}
      if(transport==='response-error'){res.emit('error',Error('response failed'));return;}
      if(transport==='large'){res.emit('data','ž'.repeat(600000));res.emit('end');return;}
      if(transport==='invalid'){res.emit('data','null');res.emit('end');return;}
      res.emit('data',options.hostname==='api.github.com'?JSON.stringify(options.path.endsWith('/latest')?latestRelease:releases):options.hostname==='kick.com' ? JSON.stringify(options.path.endsWith('/videos')?recordings:responseData) : playlist);res.emit('end');
    };
    if(transport==='wait')waiting.push(deliver);else queueMicrotask(deliver);
    return req;
  }};
  function Service(name){assert.equal(name,'com.jakubjirak.service');this.register=(name,fn)=>{handlers[name]=fn;};}
  https.Agent=class extends require('node:https').Agent{constructor(options){super(options);agents.push(options);}};
  const serviceContext=vm.createContext({Date:{now:()=>serviceNow},require(name){if(name==='https')return https;if(name==='zlib')return require('node:zlib');if(name==='webos-service')return Service;if(name==='./discovery')return require('./service/discovery');if(name==='./browser-session')return require('./service/browser-session');throw Error('Unexpected dependency: '+name);},Promise,Buffer,
    setTimeout(fn,ms){assert.equal(ms,12000);const id={};serviceTimers.set(id,fn);return id;},clearTimeout(id){serviceTimers.delete(id);}});
  vm.runInContext('Array.from = undefined;',serviceContext);
  vm.runInContext(fs.readFileSync('service/index.js','utf8'),serviceContext);
  const send=payload=>handlers.channel({payload,respond(data){replies.push(data);}});
  for(const channel of [undefined,null,'../admin','https://evil.test','foo?bar','A','a'.repeat(26)])send({channel});
  assert.equal(calls.length,0,'Invalid channels never reach the network');
  assert.ok(replies.every(r=>r.returnValue===false));replies=[];
  send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].returnValue,true);assert.equal(replies[0].videos.length,1);
  assert.equal(replies[0].videos[0].thumbnail,'https://files.kick.com/test.jpg');
  assert.equal(replies[0].videos[0].duration,60);assert.equal(replies[0].live.url,live.url);
  assert.equal(replies[0].videos[0].id,good.video.uuid);assert.equal(replies[0].videosError,null);
  replies=[];recordings=null;send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videosError.errorCode,'videos_unavailable');assert.equal(replies[0].videos.length,0);
  replies=[];recordings={error:'Rate limited'};send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videosError.errorCode,'videos_unavailable','A Kick-supplied error object is not treated as an internal failure');
  replies=[];recordings={marker:{},error:{code:'busy',params:{},message:'spoof'}};send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videosError.errorCode,'videos_unavailable','Only the private marker identifies internal failures');
  replies=[];recordings=[{...good,session_title:{toString:1}}];send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].returnValue,false);assert.equal(replies[0].errorCode,'internal');assert.match(replies[0].errorText,/could not be processed/);
  recordings=[good,{...good,session_title:''}];replies=[];send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videos[1].title,'','Missing titles stay empty for the app to localize');recordings.pop();
  assert.ok(calls.every(c=>c.hostname==='kick.com'&&c.rejectUnauthorized!==false));
  replies=[];good.session_title='🔴ONE🔴TWO🔴 𝕋𝕍 e\u030c';responseData.livestream.session_title=good.session_title;
  send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videos[0].title,'🔴ONE🔴TWO🔴 TV ě');assert.equal(replies[0].live.title,replies[0].videos[0].title);
  replies=[];good.session_title='x'.repeat(199)+'🔴tail';good.video.uuid='';good.video.id=122451580;
  send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].videos[0].title,'x'.repeat(199)+'🔴','Service truncation never splits a surrogate pair');
  assert.equal(replies[0].videos[0].id,'122451580');
  replies=[];good.video.uuid='<script>';
  send({channel:'example'});await new Promise(r=>setImmediate(r));assert.equal(replies[0].videos[0].id,'');
  replies=[];responseData.livestream=null;send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].live,null);
  replies=[];status=403;send({channel:'example'});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].returnValue,false);assert.match(replies[0].errorText,/403/);
  assert.equal(replies[0].errorCode,'http');assert.equal(replies[0].errorParams.status,403);
  assert.equal(aborted,2,'Both HTTP error responses release their network connections');
  assert.ok(calls.every(c=>c.headers['Accept-Encoding']==='gzip'&&c.agent instanceof https.Agent),'Requests accept gzip on a keep-alive agent');
  assert.equal(JSON.stringify(agents),JSON.stringify([{keepAlive:true,keepAliveMsecs:15000,maxSockets:6,maxFreeSockets:2}]));
  replies=[];status=200;transport='gzip';send({channel:'example'});await settle(()=>replies.length);
  assert.equal(replies[0].returnValue,true);assert.equal(replies[0].videos.length,1,'Compressed responses are inflated');
  for(const [mode,code] of [['gzip-large','too_large'],['gzip-bad','decode'],['unsupported-encoding','decode']]){
    const beforeAborted=aborted;replies=[];transport=mode;send({channel:'example'});
    await settle(()=>replies.length&&aborted-beforeAborted>=2);
    assert.equal(replies.length,1);assert.equal(replies[0].errorCode,code,mode);assert.equal(replies[0].returnValue,false);
    assert.equal(aborted-beforeAborted,2,mode+' aborts both transfers');
  }
  // A kept-alive socket reset by the server is retried once on a fresh connection; a second reset fails.
  transport='reset-once';resets={};replies=[];const resetStart=calls.length;send({channel:'example'});await settle(()=>replies.length);
  assert.equal(replies[0].returnValue,true);assert.equal(calls.length-resetStart,4,'Each of the two reset requests is retried exactly once');
  assert.equal(calls.slice(resetStart).filter(c=>c.agent===false).length,2,'Retries bypass the stale keep-alive pool');
  transport='reset-twice';resets={};replies=[];send({channel:'example'});await settle(()=>replies.length);
  assert.equal(replies[0].errorCode,'connect');
  transport='ok';resets={};
  replies=[];handlers.prepare({payload:{url:'https://stream.kick.com/a/{b}|c.m3u8?x=%20y'},respond(d){replies.push(d);}});
  await new Promise(r=>setImmediate(r));
  assert.equal(calls.at(-1).hostname,'stream.kick.com');assert.equal(calls.at(-1).path,'/a/%7Bb%7D%7Cc.m3u8?x=%20y','Unsafe path characters are percent-encoded without double-encoding');
  replies=[];status=200;
  handlers.prepare({payload:{url:vod.url},respond(d){replies.push(d);}});
  await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].best.height,2160,'Prefer 4K over 1440p and 1080p; exclude unsupported 8K and audio-only');
  assert.equal(replies[0].best.bitrate,18000000);
  assert.ok(replies[0].variants.length>=3);assert.ok(replies[0].variants.every(v=>v.url.startsWith('https://')));
  playlist='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="external",URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="inband"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="external"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480,AUDIO="inband"\n../480.m3u8?token=a%2Fb\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\nhttps://evil.test/360.m3u8';
  replies=[];handlers.prepare({payload:{url:vod.url},respond(d){replies.push(d);}});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].variants.length,2);assert.equal(replies[0].variants[0].manual,false);assert.equal(replies[0].variants[1].manual,true);
  assert.equal(replies[0].variants[1].url,'https://stream.kick.com/480.m3u8?token=a%2Fb');
  playlist='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="'+'x'.repeat(129)+'",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="'+'x'.repeat(129)+'"\n720.m3u8';
  replies=[];handlers.prepare({payload:{url:vod.url},respond(d){replies.push(d);}});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].variants[0].manual,false,'An unparsed audio group fails closed');

  playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080\nx.m3u8';

  playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=18000000,RESOLUTION=3840x2160\n4k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=10000000,RESOLUTION=2560x1440\n1440.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080\n1080.m3u8\n';
  for (const height of [1440,1080]) {
    playlist=playlist.replace(/#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)[^\n]*\n[^\n]+\n?/g, (variant,h)=>Number(h)>height?'':variant);
    replies=[];
    handlers.prepare({payload:{url:vod.url},respond(d){replies.push(d);}});
    await new Promise(r=>setImmediate(r));
    assert.equal(replies[0].best.height,height,'Select the next available resolution when higher variants are absent');
  }
  playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080,FRAME-RATE='+('9'.repeat(400))+'\nx.m3u8';
  replies=[];handlers.prepare({payload:{url:vod.url},respond(d){replies.push(d);}});await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].best.fps,0,'Invalid frame rates never reach UI labels');
  const before=calls.length;
  for(const url of ['http://stream.kick.com/x.m3u8','https://stream.kick.com.evil.test/x.m3u8','https://user@stream.kick.com/x.m3u8','https://127.0.0.1/x.m3u8','file:///tmp/a.m3u8']) handlers.prepare({payload:{url},respond(d){assert.equal(d.returnValue,false);}});
  assert.equal(calls.length,before,'Playlist endpoint rejects untrusted origins before any request');
  transport='wait';replies=[];const start=calls.length;
  for(let i=0;i<20;i++)send({channel:'example'});
  assert.equal(calls.length-start,2,'Concurrent identical lookups share the two HTTP requests');
  transport='ok';waiting.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  assert.equal(replies.length,20);assert.ok(replies.every(r=>r.returnValue));
  transport='wait';replies=[];const bounded=calls.length;
  for(let i=0;i<10;i++)send({channel:'channel'+i});
  assert.equal(calls.length-bounded,6,'At most six network requests may be active');
  transport='ok';waiting.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  assert.equal(replies.length,10);assert.ok(replies.some(r=>r.errorCode==='busy'));
  transport='wait';replies=[];const beforeTimeout=aborted;
  send({channel:'example'});assert.equal(serviceTimers.size,2);
  [...serviceTimers.values()].forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  assert.equal(serviceTimers.size,0);assert.equal(aborted-beforeTimeout,2);
  assert.equal(replies.length,1);assert.equal(replies[0].errorCode,'timeout');
  waiting.splice(0);
  for(const [mode,code,pattern] of [['aborted','aborted',/interrupted/],['response-error','transfer',/response failed/],['large','too_large',/too large/],['invalid','wrong_channel',/requested channel/]]){
    const beforeAborted=aborted;
    replies=[];transport=mode;send({channel:'example'});await new Promise(r=>setImmediate(r));
    assert.equal(replies.length,1);assert.match(replies[0].errorText,pattern);assert.equal(replies[0].errorCode,code);
    if(mode!=='invalid')assert.equal(aborted-beforeAborted,2,'Failed or oversized transfers are aborted');
  }
  transport='ok';handlers.channel({payload:{channel:'example'},respond(){throw Error('client closed');}});
  await new Promise(r=>setImmediate(r));
  replies=[];send({channel:'example'});await new Promise(r=>setImmediate(r));assert.equal(replies[0].returnValue,true);
  const statuses=channels=>handlers.statuses({payload:{channels},respond(d){replies.push(d);}});
  replies=[];const invalidStart=calls.length;
  for(const channels of [null,[],['../bad'],['example','example'],Array.from({length:7},(_,i)=>'c'+i)])statuses(channels);
  assert.equal(calls.length,invalidStart);assert.ok(replies.every(r=>!r.returnValue));
  replies=[];responseData.livestream={is_live:true};const statusStart=calls.length;
  statuses(['example','missing']);await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].statuses[0].live,true);assert.equal(replies[0].statuses[1].live,null);
  assert.ok(calls.slice(statusStart).every(c=>!c.path.endsWith('/videos')));
  replies=[];responseData.livestream=null;statuses(['example']);await new Promise(r=>setImmediate(r));
  assert.equal(replies[0].statuses[0].live,false);
  transport='wait';replies=[];const backgroundStart=calls.length;
  statuses(['one','two','three','four','five','six']);
  assert.equal(calls.length-backgroundStart,2,'One status batch uses two workers');
  statuses(['seven','eight']);statuses(['nine','ten']);
  assert.equal(calls.length-backgroundStart,4,'Background requests leave two foreground slots');
  send({channel:'example'});assert.equal(calls.length-backgroundStart,6,'Foreground channel lookup retains capacity');
  transport='ok';waiting.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  assert.equal(serviceTimers.size,0);
  recordings=[{is_live:false,source:vod.url,session_title:'Selected',duration:600000,video:{uuid:'selected-replay',is_private:false,status:'public'}}];
  transport='wait';replies=[];statuses(['one-a','two-b']);statuses(['three-c','four-d']);
  const foregroundReplayStart=calls.length;
  handlers.replay({payload:{channel:'selected',id:'selected-replay'},respond(d){replies.push(d);}});
  assert.equal(calls.length,foregroundReplayStart+1,'Selected history replay keeps foreground capacity while four background requests finish');
  transport='ok';waiting.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  assert.ok(replies.some(r=>r.video&&r.video.id==='selected-replay'));

  transport='ok';status=200;replies=[];
  const release=(version,extra={})=>({tag_name:'v'+version,html_url:'https://github.com/JirakJ/kick-web-os-app/releases/tag/v'+version,body:'Safe <b>notes</b>',draft:false,prerelease:false,...extra});
  const checkUpdates=()=>handlers.updates({payload:{url:'https://evil.test'},respond(d){replies.push(d);}});
  releases=Array.from({length:10},(_,i)=>release('1.0.'+i,{prerelease:true}));latestRelease=release('0.10.0');
  checkUpdates();await new Promise(r=>setImmediate(r));assert.equal(replies[0].returnValue,true,'Latest stable is available behind ten newer prereleases');assert.equal(replies[0].release.version,'0.10.0');assert.equal(calls.at(-1).hostname,'api.github.com');assert.equal(calls.at(-1).path,'/repos/JirakJ/kick-web-os-app/releases/latest');assert.ok(calls.at(-1).headers['User-Agent']);
  const updateCalls=calls.length;replies=[];checkUpdates();await new Promise(r=>setImmediate(r));assert.equal(calls.length,updateCalls,'Fresh update metadata is cached');
  serviceNow+=21600001;latestRelease={message:'bad data'};replies=[];checkUpdates();await new Promise(r=>setImmediate(r));assert.equal(replies[0].returnValue,false);
  const negativeCalls=calls.length;checkUpdates();await new Promise(r=>setImmediate(r));assert.equal(calls.length,negativeCalls,'Malformed/rate-limited checks back off');
  serviceNow+=60001;status=429;replies=[];checkUpdates();await new Promise(r=>setImmediate(r));assert.equal(replies[0].returnValue,false);status=200;
  console.log('TV service: passed (channel validation, fixed API origin, public replays only, media URL validation, offline and HTTP errors).');
}
testService().catch(e=>{console.error(e);process.exitCode=1;});

// Physical-remote UX contract: fullscreen is not pause, menu Back is not exit,
// and remembered accelerated rates cannot send ordinary playback into a browser.
const controlsStore=new Map([['kick-speed-preference','2']]);let browserLaunches=0;
const disabledRuntime={browser:false,remotePlayback:false,initial:null,cancelOpen(){},collect(done){done(null);},open(){browserLaunches++;throw Error('Unexpected browser handoff');}};
boot({getItem:k=>controlsStore.get(k)||null,setItem:(k,v)=>controlsStore.set(k,v)},'ok','ru',true,1000,disabledRuntime);
submit('example');respond({live:null,videos:[vod]});elements.videos.firstChild.handlers.click();qualityResponse();ready();
assert.equal(browserLaunches,0);assert.equal(controlsStore.get('kick-speed-preference'),'2','Keep the user preference without auto-launching');
assert.match(elements['speed-button'].textContent,/1×/,'Show the actual native rate, not the remembered unsupported rate');
click('speed-button');assert.equal(elements['speed-options'].children[4].disabled,true);key(461);
const fullVideo=node();click('hide-controls');assert.equal(elements['playback-controls'].hidden,true);assert.equal(node(),fullVideo);assert.equal(node().paused,false);
key(13);assert.equal(elements['playback-controls'].hidden,false);assert.equal(document.activeElement,elements.toggle);assert.equal(node().paused,false,'OK reveals controls without toggling transport');
key(461);assert.equal(elements['playback-controls'].hidden,true);assert.equal(node(),fullVideo,'First Back hides the menu only');
key(461);assert.equal(elements.watch.hidden,true);assert.equal(elements.catalog.hidden,false);assert.equal(node(),undefined,'Second Back leaves and disposes media');
elements.videos.firstChild.handlers.click();qualityResponse();ready();elements.seek.focus();key(13);assert.equal(elements['playback-controls'].hidden,true);assert.equal(browserLaunches,0,'OK on timeline cannot enter browser');
key(457);assert.equal(elements['playback-controls'].hidden,false);click('toggle');assert.equal(node().paused,true);click('hide-controls');assert.equal(elements['playback-controls'].hidden,true,'A paused frame can also be shown without menu');
key(40);assert.equal(elements['playback-controls'].hidden,false);assert.equal(node().paused,true);
console.log('Remote player controls: passed (no implicit browser, actual-rate label, hidden/visible OK and Back, explicit hide, paused frame, INFO, decoder disposal).');

// Back has the same two-step contract after terminal playback failure.
boot();submit('example');respond();
for(let attempt=0;attempt<3;attempt++){node().error={code:3};node().handlers.error();advance(600);}
assert.equal(elements['playback-controls'].hidden,false);key(461);
assert.equal(elements.watch.hidden,false);assert.equal(elements['playback-controls'].hidden,true);
key(461);assert.equal(elements.catalog.hidden,false);assert.equal(node(),undefined);
console.log('Terminal-error controls: passed (first Back hides, second exits).');
