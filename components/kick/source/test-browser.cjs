'use strict';
// Real browser layout/focus checks; Luna/media fixtures do not establish native TV playback or Voice Guide support.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),i18n=require('./app/i18n.js'),checkLayout=require('./test-layout.cjs');
const output='artifacts/browser';fs.mkdirSync(output,{recursive:true});for(const name of ['failure.png','result.json'])if(fs.existsSync(`${output}/${name}`))fs.unlinkSync(`${output}/${name}`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 let checks=0;
 const selectedLocales=process.env.TEST_LANGUAGES?i18n.languages.filter(x=>process.env.TEST_LANGUAGES.split(',').includes(x)):i18n.languages;
 try{
  for(const viewport of [{width:1280,height:720},{width:1920,height:1080}])for(const locale of selectedLocales)for(const {large,high} of [{large:false,high:true},{large:false,high:false},{large:true,high:false},{large:true,high:true}]){
   const context=await browser.newContext({viewport,locale:locale+'-'+locale.toUpperCase(),reducedMotion:'reduce'}),page=await context.newPage();
   page.setDefaultTimeout(5000);
   await page.route('https://**/*',route=>route.abort());
   await page.addInitScript(({locale,large,high})=>{
    window.webOSSystem={locale,platformBack(){}};
    localStorage.clear();localStorage.setItem('kick-browse-mode','library');
    localStorage.setItem('kick-accessibility',JSON.stringify({size:large?'large':'normal',contrast:high}));
    localStorage.setItem('kick-recent-channels',JSON.stringify(['example','channel_two','channel_three','channel_four','channel_five','channel_six']));
    localStorage.setItem('kick-favorites',JSON.stringify(['example','channel_two','channel_three','channel_four','channel_five','channel_six','channel_seven']));
    localStorage.setItem('kick-watched-videos',JSON.stringify(Array.from({length:6},(_,i)=>({key:'example:replay-'+i,position:100+i,duration:600,finished:i%2!==0}))));
    const videos=Array.from({length:14},(_,i)=>({id:'replay-'+i,title:'Replay '+i+' 🔴 👩🏽‍💻 Čaj — '+('Long replay title '.repeat(8))+i,url:'https://stream.kick.com/a/master.m3u8',date:'2026-10-18',duration:600,thumbnail:'https://files.kick.com/test.jpg'}));
    const live={...videos[0],isLive:true};
    const variants=[{url:'https://stream.kick.com/a/1080.m3u8',width:1920,height:1080,bitrate:7000000,fps:60,manual:true},{url:'https://stream.kick.com/a/720.m3u8',width:1280,height:720,bitrate:3000000,fps:30,manual:true}];
    window.PalmServiceBridge=function(){this.cancel=()=>{this.cancelled=true;};this.call=(uri,json)=>{
     const data=JSON.parse(json);let reply;
     if(uri.endsWith('/channel'))reply={returnValue:true,channel:data.channel,live,videos};
     else if(uri.endsWith('/statuses'))reply=window.fixtureStatusesUnavailable?{returnValue:false}:{returnValue:true,statuses:data.channels.map(channel=>({channel,live:true}))};
     else if(uri.endsWith('/replay'))reply=window.fixtureReplayUnavailable?{returnValue:false}:{returnValue:true,video:videos.find(v=>v.id===data.id)||null};
     else if(uri.endsWith('/prepare'))reply={returnValue:true,best:variants[0],variants};
     else reply={returnValue:false};
     setTimeout(()=>{if(!this.cancelled)this.onservicecallback(JSON.stringify(reply));},5);
    };};
    const proto=HTMLMediaElement.prototype;
    Object.defineProperty(proto,'paused',{get(){return !this.__playing;}});
    Object.defineProperty(proto,'duration',{get(){return 600;}});
    proto.play=function(){this.__playing=true;setTimeout(()=>this.dispatchEvent(new Event('playing')),0);return Promise.resolve();};
    proto.pause=function(){this.__playing=false;};
    proto.load=function(){if(this.isConnected&&this.firstChild)setTimeout(()=>{this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('loadeddata'));},0);};
   },{locale,large,high});
   await page.goto(pathToFileURL(path.resolve('app/index.html')).href);
   await page.evaluate(()=>document.fonts.ready);
   async function audit(stage){
    const errors=await page.evaluate(checkLayout);
    if(errors.length){await page.screenshot({path:`${output}/failure.png`,fullPage:true});console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('.title-symbol')).filter(e=>e.getClientRects().length).slice(0,2).map(e=>({text:e.textContent,height:e.clientHeight,scroll:e.scrollHeight,rect:e.getBoundingClientRect().height,line:getComputedStyle(e).lineHeight,font:getComputedStyle(e).fontSize}))));}
    assert.deepEqual(errors,[],`${viewport.width}/${locale}/${(large?'large':'normal')+(high?'-high':'')}/${stage}`);
    const controls=await page.evaluate(({high})=>{
     const modal=Array.from(document.querySelectorAll('[role="dialog"]')).find(e=>e.getClientRects().length);
     const root=modal||document;const errors=[];
     const lum=c=>{const a=(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*a[0]+.7152*a[1]+.0722*a[2];};
     for(const e of root.querySelectorAll('button,input,a[href]')){
      if(!e.getClientRects().length||e.disabled)continue;
      const name=e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')&&document.getElementById(e.getAttribute('aria-labelledby'))?.textContent||
       Array.from(document.querySelectorAll('label')).find(label=>label.htmlFor===e.id)?.textContent||e.textContent;
      if(!name?.trim())errors.push(e.id+': missing accessible name');
      e.focus();if(document.activeElement!==e)errors.push(e.id+': focus failed');
      const style=getComputedStyle(e);if(style.outlineStyle==='none'||parseFloat(style.outlineWidth)<4)errors.push(e.id+': focus outline missing');
      if(high&&style.outlineColor!=='rgb(255, 255, 0)')errors.push(e.id+': high contrast focus is inconsistent');
      if(high){const a=lum(style.color),b=lum(style.backgroundColor),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);if(!Number.isFinite(ratio)||ratio<7)errors.push(e.id+': contrast '+ratio);}
     }
     return errors;
    },{high});
    assert.deepEqual(controls,[],`${locale}/${stage} controls`);checks++;
   }
   await page.waitForFunction(()=>document.querySelectorAll('#favorite-list button').length>0);
   await page.waitForTimeout(40);
   await audit('home');
   const homeFit=await page.evaluate(()=>{const region=document.getElementById('home-content'),errors=[];if(region.scrollHeight>region.clientHeight+1)errors.push('Home needs vertical scrolling');if(document.documentElement.scrollHeight>innerHeight+1)errors.push('Page needs vertical scrolling');for(const e of document.querySelectorAll('#home button,#home input')){if(!e.getClientRects().length)continue;const r=e.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)errors.push((e.id||e.className)+': control outside screen');}return errors;});
   assert.deepEqual(homeFit,[],`${viewport.width}/${locale}/${large?'large':'normal'}/home fits without scrolling`);
   const footerBoxes=await page.evaluate(()=>{const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return{footer:document.querySelector('footer').getBoundingClientRect().toJSON(),version:bounds('app-version'),about:bounds('about-button'),accessibility:bounds('accessibility-button'),height:innerHeight};});
   assert(footerBoxes.version.top>=0&&footerBoxes.version.bottom<=footerBoxes.height,'Home version stays visible above the screen edge with populated shelves');
   for(const id of ['about','accessibility'])assert(footerBoxes[id].top>=footerBoxes.footer.top&&footerBoxes[id].bottom<=footerBoxes.footer.bottom,'Secondary actions stay within the visible footer');
   for(const selector of ['.recent-row:last-child .recent-favorite','.favorite-row:last-child button:last-child','.continue-row:last-child button:last-child']){
    await page.evaluate(selector=>{const e=document.querySelector(selector);e.focus();e.scrollIntoView({block:'nearest'});},selector);
    await page.waitForTimeout(25);
    const focusBox=await page.evaluate(()=>{const a=document.activeElement.getBoundingClientRect(),b=document.getElementById('home-content').getBoundingClientRect();return{top:a.top,bottom:a.bottom,containerTop:b.top,containerBottom:b.bottom};});
    assert(focusBox.top>=focusBox.containerTop+10&&focusBox.bottom<=focusBox.containerBottom-10,'Scrolling home controls retain the complete focus outline above the footer: '+selector+' '+JSON.stringify(focusBox));
   }

   if(locale==='en'){
    for(const [list,row,prefix,count] of [['recent-channels','.recent-name','recent',6],['favorite-list','.favorite-row button:first-child > span:first-child','favorite',7],['continue-list','.continue-row button:first-child','continue',3]]){
     const names=[];do{names.push(...await page.locator('#'+list+' '+row).allTextContents());if(await page.locator('#'+prefix+'-next').isDisabled())break;await page.click('#'+prefix+'-next');}while(names.length<=count);
     assert.equal(names.length,count,'Paging reaches every saved item without scrolling');assert.equal(new Set(names).size,count,'Paging neither repeats nor loses items');
     while(!await page.locator('#'+prefix+'-previous').isDisabled())await page.click('#'+prefix+'-previous');
    }
    await page.screenshot({path:`${output}/home-${viewport.width}-${large?'large':'normal'}-${high?'high':'normal'}.png`});
    await page.locator('.recent-row:first-child .recent-remove').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.favorite-row button')),true,'Right crosses to the same row in the adjacent panel');
    await page.locator('.favorite-row button').first().focus();await page.keyboard.press('ArrowDown');if(await page.locator('.favorite-row').count()>1)assert.equal(await page.evaluate(()=>document.activeElement===document.querySelectorAll('.favorite-row')[1].firstChild),true,'Down follows the painted single-column rows');
    if(viewport.width===1280&&!large){await page.locator('#recent-next').focus();}
    await page.setViewportSize(viewport.width===1280?{width:1920,height:1080}:{width:1280,height:720});await page.waitForTimeout(40);if(viewport.width===1280&&!large)assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.recent-row button')||document.activeElement===document.getElementById('recent-next')&&!document.getElementById('recent-next').disabled),true,'Resize preserves focus on the still-visible pager or restores it within its panel');await page.setViewportSize(viewport);await page.waitForTimeout(40);
    const resized=await page.evaluate(()=>{const e=document.getElementById('home-content');return{scroll:e.scrollHeight,height:e.clientHeight,focused:document.activeElement!==document.body&&document.activeElement.getClientRects().length>0};});assert(resized.scroll<=resized.height+1&&resized.focused,'Resize preserves visible focus and a fitted home');
   }
   if(large&&(locale==='en'||locale==='de')){
    await page.addInitScript(()=>{window.fixtureStatusesUnavailable=true;});await page.reload();await page.waitForTimeout(60);
    const readable=await page.evaluate(()=>Array.from(document.querySelectorAll('.favorite-row button:first-child')).every(e=>e.firstChild.getBoundingClientRect().width>=e.clientWidth*.4));
    assert(readable,'Unavailable status preserves meaningful width for favorite channel names');
   }
   await page.click('#accessibility-button');await audit('settings');await page.click('#accessibility-close');
   await page.click('#find-saved');await page.fill('#saved-query','channel');await audit('saved-search');await page.click('#saved-cancel');
   await page.click('#recordings');await page.waitForFunction(()=>document.querySelectorAll('#videos>button').length>0);await page.waitForTimeout(40);await audit('catalog');
   if(locale==='de'&&large){
    await page.click('#catalog-back');await page.fill('#channel','abcdefghijklmnopqrstuvwxy');await page.click('#recordings');await page.waitForTimeout(60);
    const completeLong=await page.evaluate(()=>Array.from(document.querySelectorAll('#videos>button')).every(card=>{const b=card.getBoundingClientRect();return Array.from(card.querySelectorAll('.video-preview,.video-title,small')).every(e=>{const r=e.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&(e.className!=='video-preview'||r.width>=b.width-8);});}));assert(completeLong,'A valid maximum-length channel keeps complete replay cards visible');
    await page.click('#catalog-back');await page.evaluate(()=>{window.fixtureReplayUnavailable=true;});await page.locator('.continue-row button').first().click();await page.waitForTimeout(100);
    const completeUnavailable=await page.evaluate(()=>Array.from(document.querySelectorAll('#videos>button')).every(card=>{const b=card.getBoundingClientRect();return Array.from(card.querySelectorAll('.video-preview,.video-title,small')).every(e=>{const r=e.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&(e.className!=='video-preview'||r.width>=b.width-8);});}));assert(completeUnavailable,'An unavailable Continue item keeps the remaining replay cards complete');assert(await page.locator('#videos-status').textContent());
    await page.evaluate(()=>{window.fixtureReplayUnavailable=false;});await page.click('#catalog-back');await page.fill('#channel','example');await page.click('#recordings');await page.waitForTimeout(60);
   }
   // Legacy TV buttons align flex children at the start; previews must keep their width.
   await page.evaluate(()=>document.querySelectorAll('.video-preview').forEach(e=>{e.style.alignSelf='flex-start';}));
   const catalogFit=await page.evaluate(()=>Array.from(document.querySelectorAll('#catalog button')).filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));assert(catalogFit,'Catalog cards and paging fit the screen without scrolling');
   const completeCards=await page.evaluate(()=>Array.from(document.querySelectorAll('#videos>button')).every(card=>{const b=card.getBoundingClientRect();return Array.from(card.querySelectorAll('.video-preview,.video-title,small')).every(e=>{const r=e.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&(e.className!=='video-preview'||r.width>=b.width-8);});}));assert(completeCards,'Thumbnails, titles and dates fit fully inside each replay card');
   const columns=await page.evaluate(()=>{const cards=Array.from(document.querySelectorAll('#videos>button'));const y=cards[0].getBoundingClientRect().top;return cards.filter(c=>Math.abs(c.getBoundingClientRect().top-y)<1).length;});
   assert.equal(columns,large?2:3,'Remote grid columns match painted columns');
   if(locale==='en'&&large&&high)await page.screenshot({path:`${output}/catalog-${viewport.width}.png`,fullPage:true});
   if(locale==='en'&&!large&&viewport.width===1280){
    await page.click('#next-page');const savedTitle=await page.locator('#videos .video-title').first().textContent();await page.click('#catalog-search');await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(40);await page.click('#replay-cancel');assert((await page.locator('#videos .video-title').allTextContents()).includes(savedTitle),'Cancel after resizing search retains the original replay in view');await page.setViewportSize(viewport);await page.waitForTimeout(40);while(!await page.locator('#previous-page').isDisabled())await page.click('#previous-page');
   }
   await page.click('#catalog-search');await page.fill('#replay-query','Čaj');await audit('replay-search');await page.click('#replay-cancel');
   await page.click('#videos>button');await page.waitForFunction(()=>!document.getElementById('resume-choice').hidden);await audit('resume');await page.click('#resume-start');
   await page.waitForFunction(()=>document.querySelector('#video-host video'));await audit('watch');
   await page.click('#quality-button');await audit('quality');
   const qualityFocus=await page.evaluate(()=>document.activeElement.id);await page.keyboard.press('Pause');assert.equal(await page.locator('video').evaluate(e=>e.paused),true,'Pause works with quality open');assert.equal(await page.evaluate(()=>document.activeElement.id),qualityFocus);
   await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:415,bubbles:true})));assert.equal(await page.locator('video').evaluate(e=>e.paused),false);await page.click('#quality-cancel');
   await page.click('#jump-time');await audit('jump');
   const jumpFocus=await page.evaluate(()=>document.activeElement.id);await page.keyboard.press('Pause');assert.equal(await page.locator('video').evaluate(e=>e.paused),true,'Pause works with Jump open');assert.equal(await page.evaluate(()=>document.activeElement.id),jumpFocus);
   await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:415,bubbles:true})));assert.equal(await page.locator('video').evaluate(e=>e.paused),false);await page.click('#jump-cancel');
   await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await audit('offline-watch');
   if(locale==='en'&&large&&high)await page.screenshot({path:`${output}/watch-${viewport.width}.png`});
   await page.click('#back');await page.click('#about-button');await audit('about');
   assert.ok(await page.locator('body *').count()<1200,'DOM stays bounded with all feature shelves');
   await context.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(`${output}/result.json`,JSON.stringify({checks,locales:selectedLocales,resolutions:['1280x720','1920x1080'],modes:['normal','high-contrast','large','large-high-contrast'],nativePlayback:false,voiceGuide:false},null,2)+'\n');
 console.log(`Browser accessibility/layout: ${checks} screens passed across ${selectedLocales.length} locales, 720p/1080p and all four size/contrast modes (native TV acceptance pending).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
