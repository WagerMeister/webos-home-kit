/* TV-only connection control. ES5; no account credentials or remote QR service. */
(function(root,doc){
  'use strict';
  var COMMANDS={providers:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js providers',select:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js select',status:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js status',on:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js on',off:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js off',login:'/usr/bin/node /var/lib/webosbrew/tv-vpn/control.js login'};
  var words={starting:'Проверка статуса…',on:'Включён',off:'Выключен','off-login':'Выключен · нужен вход',login:'Требуется вход',approval:'Нужно одобрить устройство',connecting:'VPN подключается…',disconnecting:'Выключается…','exit-offline':'Сервер недоступен','endpoint-offline':'Сервер недоступен',setup:'Требуется настройка',failed:'Не подключён · сеть восстановлена',error:'Нет соединения'};
  var engineModal=null,engineButtons=[],engineNote=null,engineList=null,engineFocus=null;
  var card=null,home=null,modal=null,qr=null,note=null,openButton=null,laterButton=null,offButton=null;
  var status={state:'starting',enabled:false},timer=null,request=null,pendingAction='',generation=0,focused=false,armed=false,savedTile=null,authURL=null,modalOpen=false,lastIssued=0,authPromptWanted=false;
  function element(tag,className,text){var node=doc.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;}
  function showing(){home=doc.querySelector('#root > .screen');return !doc.hidden&&home&&!home.classList.contains('screen--away')&&!home.classList.contains('screen--settings')&&!home.classList.contains('screen--picker');}
  function cancel(){generation++;if(request){try{request.cancel();}catch(error){}request=null;}pendingAction='';}
  function call(action,done,provider){
    if(!COMMANDS[action]||!root.PalmServiceBridge){done(null);return;}
    cancel();var seq=generation,bridge=new root.PalmServiceBridge(),ended=false;
    var deadline=root.setTimeout(function(){finish(null);},6500);
    function finish(value){if(ended)return;ended=true;root.clearTimeout(deadline);try{bridge.cancel();}catch(error){}if(seq!==generation)return;request=null;pendingAction='';done(value);}
    request=bridge;pendingAction=action;
    bridge.onservicecallback=function(message){try{var reply=JSON.parse(message);if(!reply.returnValue||typeof reply.stdoutString!=='string')throw Error('bridge');var value=JSON.parse(reply.stdoutString);if(value.returnValue!==true||!words[value.state])throw Error('status');finish(value);}catch(error){finish(null);}};
    var now=Date.now();if(lastIssued>now+5000)lastIssued=0;lastIssued=Math.max(now,lastIssued+1);
    try{bridge.call('luna://org.webosbrew.hbchannel.service/exec',JSON.stringify({command:COMMANDS[action]+' '+lastIssued+(action==='select'&&/^[a-z][a-z0-9-]{0,31}$/.test(provider||'')?' '+provider:'')}));}catch(error){finish(null);}
  }
  function render(value){
    status=value||{state:'error',enabled:false};
    card.setAttribute('data-state',status.state);card.setAttribute('aria-checked',status.enabled===true?'true':'false');
    card.setAttribute('aria-label','VPN. '+words[status.state]+'. OK — переключить; вниз — приложения.');
    card.querySelector('.hearth-vpn-status').textContent=words[status.state];
    if(modalOpen){
      note.textContent=status.state==='login'||status.state==='off-login'?'Завершите вход в VPN.':words[status.state];
      if(status.state==='on'){closeModal();return;}
    }
  }
  function schedule(delay){root.clearTimeout(timer);timer=null;if(showing())timer=root.setTimeout(poll,delay);}
  function poll(){
    timer=null;if(!showing()||request)return;
    call('status',function(value){render(value);if(value&&value.state==='login'&&authPromptWanted&&supportsLogin(value)&&!modalOpen)showLogin();else if(modalOpen&&value&&value.loginReady&&!authURL)fetchLogin();else schedule(modalOpen?3000:5000);});
  }
  function restoreFocus(){
    focused=false;armed=false;doc.documentElement.classList.remove('hearth-vpn-focused');card.blur();
    if(savedTile&&doc.documentElement.contains(savedTile)){try{savedTile.focus();}catch(error){}}savedTile=null;
  }
  function focusCard(){savedTile=doc.querySelector('#root > .screen .tile--focused');focused=true;doc.documentElement.classList.add('hearth-vpn-focused');card.focus();}
  function closeModal(){authPromptWanted=false;if(!modalOpen)return;modalOpen=false;modal.hidden=true;authURL=null;qr.textContent='';if(showing()){focused=true;doc.documentElement.classList.add('hearth-vpn-focused');card.focus();}schedule(100);}
  function supportsLogin(value){return value&&value.capabilities?value.capabilities.browserLogin===true:!!(value&&typeof value.loginReady==='boolean');}
  function safeLoginURL(value){return typeof value==='string'&&value.length<512&&/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[A-Za-z0-9._~!$&()*+,;=:%?@/#-]*$/.test(value);}
  function drawQR(url){
    if(!safeLoginURL(url))return;
    authURL=url;openButton.disabled=false;
    if(typeof root.qrcode==='function'){var code=root.qrcode(0,'M');code.addData(url);code.make();qr.innerHTML=code.createSvgTag({scalable:true,margin:4});}
    else qr.textContent='Откройте вход на телевизоре';
  }
  function fetchLogin(){
    call('login',function(value){render(value);if(modalOpen&&value&&value.authURL)drawQR(value.authURL);schedule(2500);});
  }
  function showLogin(){
    modalOpen=true;modal.hidden=false;qr.textContent='Подготовка входа…';openButton.disabled=true;authURL=null;laterButton.focus();fetchLogin();
  }
  function action(name){
    authPromptWanted=name==='on';
    root.clearTimeout(timer);timer=null;
    call(name,function(value){render(value);if(name==='off')closeModal();if(name==='on'&&value&&!value.authenticated&&supportsLogin(value))showLogin();else schedule(500);});
  }
  function closeEngines(){
    if(!engineModal)return;
    armed=false;
    engineModal.parentNode.removeChild(engineModal);engineModal=null;engineButtons=[];
    if(engineFocus&&doc.documentElement.contains(engineFocus))engineFocus.focus();
    engineFocus=null;schedule(100);
  }
  function listEngines(value){
    if(!engineModal)return;
    engineList.textContent='';engineButtons=[];
    engineNote.textContent=!value?'Не удалось получить состояние. Закройте меню и повторите.':value.canSelect?'Выберите установленный движок.':'Перед сменой движка выключите VPN и дождитесь восстановления сети.';
    (value&&value.providers||[]).forEach(function(item){
      if(!/^[a-z][a-z0-9-]{0,31}$/.test(item.id))return;
      var button=element('button','',item.label+(item.selected?' · выбран':''));button.type='button';button.disabled=!value.canSelect;
      button.onclick=function(){call('select',listEngines,item.id);};engineList.appendChild(button);engineButtons.push(button);
    });
    if(!value||!value.providers||!value.providers.length)engineList.appendChild(element('p','','Нет подготовленных движков.'));
    if(value&&value.wanted){var off=element('button','','Отключить');off.type='button';off.onclick=function(){call('off',function(){call('providers',listEngines);});};engineList.appendChild(off);engineButtons.push(off);}
    var refresh=element('button','','Обновить'),back=element('button','','Назад');
    refresh.type=back.type='button';refresh.onclick=function(){call('providers',listEngines);};back.onclick=closeEngines;
    engineList.appendChild(refresh);engineList.appendChild(back);engineButtons.push(refresh,back);
    engineButtons.filter(function(b){return !b.disabled;})[0].focus();
  }
  function openEngines(){
    if(engineModal)return;
    engineFocus=doc.activeElement;root.clearTimeout(timer);cancel();
    engineModal=element('div','hearth-vpn-modal');engineModal.setAttribute('role','dialog');engineModal.setAttribute('aria-modal','true');engineModal.setAttribute('aria-label','VPN — движок');
    var dialog=element('section','hearth-vpn-dialog');dialog.appendChild(element('h1','','VPN — движок'));
    engineNote=element('p','hearth-vpn-modal-status','Получение состояния…');dialog.appendChild(engineNote);
    engineList=element('div','hearth-vpn-engines');dialog.appendChild(engineList);engineModal.appendChild(dialog);doc.body.appendChild(engineModal);
    call('providers',listEngines);
  }
  root.__hearthVPNSettings=openEngines;
  function key(event){
    if(engineModal){
      var code=event.keyCode;
      if([13,27,37,38,39,40,461].indexOf(code)<0)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type==='keyup'){if(code===13&&armed){armed=false;if(doc.activeElement&&engineButtons.indexOf(doc.activeElement)>=0)doc.activeElement.click();}return;}
      if(code===13){if(!event.repeat)armed=true;return;}
      if(code===27||code===461){armed=false;closeEngines();return;}
      var enabled=engineButtons.filter(function(b){return !b.disabled;});if(!enabled.length)return;
      var at=enabled.indexOf(doc.activeElement),direction=code===37||code===38?-1:1;enabled[(Math.max(0,at)+direction+enabled.length)%enabled.length].focus();return;
    }
    if(!card||!showing())return;
    var code=event.keyCode;
    if(modalOpen){
      if([13,27,37,38,39,40,461].indexOf(code)<0)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type==='keyup'){
        if(code===13&&armed){armed=false;if(doc.activeElement&&doc.activeElement.tagName==='BUTTON'&&!doc.activeElement.disabled)doc.activeElement.click();}
        return;
      }
      if(code===13){if(!event.repeat)armed=true;return;}
      if(code===27||code===461){closeModal();return;}
      var buttons=[openButton,laterButton,offButton].filter(function(b){return !b.disabled;});
      var at=buttons.indexOf(doc.activeElement),direction=code===37||code===38?-1:1;buttons[(Math.max(0,at)+direction+buttons.length)%buttons.length].focus();return;
    }
    if(focused||doc.activeElement===card){
      if([13,27,37,38,39,40,461].indexOf(code)<0)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type==='keyup'){if(code===13&&armed){armed=false;card.click();}return;}
      if(code===13){if(!event.repeat)armed=true;}
      else if(code===40||code===27||code===461)restoreFocus();
      else if(code===37)action('off');else if(code===39)action('on');
      return;
    }
    var row=doc.querySelector('#root > .screen .row--focused'),first=doc.querySelector('#root > .screen .row');
    if(event.type==='keydown'&&code===38&&row&&row===first&&!doc.querySelector('#root > .screen .movehint')){event.preventDefault();event.stopImmediatePropagation();focusCard();}
  }
  function visibility(){
    var visible=showing();if(card)card.hidden=!visible;
    root.clearTimeout(timer);timer=null;
    if(!visible){cancel();authPromptWanted=false;if(modalOpen){modalOpen=false;modal.hidden=true;}authURL=null;restoreFocus();}
    else schedule(100);
  }
  function attach(){
    home=doc.querySelector('#root > .screen');if(!home)return false;
    card=element('button','hearth-vpn-card');card.id='hearth-vpn';card.type='button';card.setAttribute('role','switch');card.setAttribute('aria-checked','false');
    var copy=element('span','hearth-vpn-copy');copy.appendChild(element('span','hearth-vpn-title','VPN'));copy.appendChild(element('span','hearth-vpn-status',words.starting));card.appendChild(copy);
    var track=element('span','hearth-vpn-track');track.setAttribute('aria-hidden','true');track.appendChild(element('span','hearth-vpn-thumb'));card.appendChild(track);doc.body.appendChild(card);
    card.onclick=function(event){event.stopPropagation();if(!focused){savedTile=doc.querySelector('.tile--focused');focused=true;doc.documentElement.classList.add('hearth-vpn-focused');}var wanted=typeof status.wanted==='boolean'?status.wanted:status.enabled;action(wanted?'off':'on');};
    modal=element('div','hearth-vpn-modal');modal.id='hearth-vpn-login';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','hearth-vpn-heading');
    var dialog=element('section','hearth-vpn-dialog'),title=element('h1','','Вход в VPN');title.id='hearth-vpn-heading';dialog.appendChild(title);
    var login=element('div','hearth-vpn-login');qr=element('div','hearth-vpn-qr');login.appendChild(qr);
    var instructions=element('div','hearth-vpn-instructions','Отсканируйте QR-код телефоном и завершите вход в выбранный сервис.');instructions.appendChild(element('small','','После входа телевизор подключится к выходному узлу, указанному в локальной конфигурации. Можно также открыть вход в браузере телевизора.'));login.appendChild(instructions);dialog.appendChild(login);
    note=element('p','hearth-vpn-modal-status','');note.setAttribute('role','status');dialog.appendChild(note);
    var buttons=element('div','hearth-vpn-actions');openButton=element('button','','Открыть на телевизоре');laterButton=element('button','','Позже');offButton=element('button','','Отключить');[openButton,laterButton,offButton].forEach(function(b){b.type='button';buttons.appendChild(b);});dialog.appendChild(buttons);modal.appendChild(dialog);doc.body.appendChild(modal);
    laterButton.onclick=closeModal;offButton.onclick=function(){closeModal();action('off');};
    openButton.onclick=function(){if(!authURL)return;var bridge=new root.PalmServiceBridge();bridge.onservicecallback=function(){try{bridge.cancel();}catch(error){}};bridge.call('luna://com.webos.applicationManager/launch',JSON.stringify({id:'com.webos.app.browser',params:{target:authURL}}));};
    root.addEventListener('keydown',key,true);root.addEventListener('keyup',key,true);
    doc.addEventListener('mousedown',function(event){if(focused&&!modalOpen&&!card.contains(event.target))restoreFocus();},true);
    doc.addEventListener('visibilitychange',function(){if(doc.hidden)closeEngines();visibility();});
    doc.addEventListener('webOSRelaunch',function(){closeEngines();closeModal();restoreFocus();visibility();});
    var homeObserver=new root.MutationObserver(visibility);
    var observer=new root.MutationObserver(function(){var current=doc.querySelector('#root > .screen');if(current!==home){homeObserver.disconnect();home=current;if(home)homeObserver.observe(home,{attributes:true,attributeFilter:['class']});}visibility();});observer.observe(doc.getElementById('root'),{childList:true});homeObserver.observe(home,{attributes:true,attributeFilter:['class']});
    visibility();return true;
  }
  if(!attach()){var observer=new root.MutationObserver(function(){if(attach())observer.disconnect();});observer.observe(doc.getElementById('root')||doc.body,{childList:true,subtree:true});}
}(window,document));
