(function(){'use strict';var msg=document.getElementById('status'),btn=document.getElementById('open'),bridge;
function fallback(text){msg.textContent=text;btn.hidden=false;btn.focus();}
btn.onclick=function(){var b=new PalmServiceBridge();b.call('luna://com.webos.applicationManager/launch',JSON.stringify({id:'vkvideo'}));};
if(typeof PalmServiceBridge!=='function'){fallback('Не удалось запустить ускоритель. Откройте VK обычным способом.');return;}
bridge=new PalmServiceBridge();bridge.onservicecallback=function(raw){var r;try{r=JSON.parse(raw);}catch(e){r={};}if(r.returnValue!==true)fallback('Откройте обычный VK, запустите видео, затем сразу нажмите Home и выберите VK ×2. Поддерживаются некоторые HLS- и MP4-видео.');};
try{bridge.call('luna://org.local.vkspeed.service/launch','{}');}catch(e){fallback('Не удалось запустить ускоритель. Откройте VK обычным способом.');}
}());
