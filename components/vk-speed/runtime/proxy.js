'use strict';
// Session-private HLS bridge: only URLs discovered in an allowed VK manifest.
// No cookies, credentials, arbitrary client-supplied URLs or redirects.
var url=require('url'),http=require('http'),https=require('https'),dns=require('dns'),crypto=require('crypto'),net=require('net'),fs=require('fs');
function allowed(value){
  if(typeof value!=='string'||value.length>8192)return false;
  var p;try{p=url.parse(value);}catch(e){return false;}
  return /^(http:|https:)$/.test(p.protocol||'')&&!p.auth&&!p.hash&&
    /^(?:[a-z0-9-]+\.)*(?:okcdn\.ru|vkuser\.net|vkvideo\.ru)$/i.test(p.hostname||'')&&
    (!p.port||(p.protocol==='http:'&&p.port==='80')||(p.protocol==='https:'&&p.port==='443'));
}
function publicIPv4(ip){
  if(net.isIP(ip)!==4)return false;
  var a=ip.split('.').map(Number),x=a[0],y=a[1];
  return !(x===0||x===10||x===127||x>=224||(x===100&&y>=64&&y<=127)||
    (x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&(y===168||y===0))||
    (x===198&&(y===18||y===19)));
}
function create(prefix,initial){
  var entries={},reverse={},active=0,stats={manifests:0,segments:0,failures:0,last:null};
  function diag(reason){stats.last=reason;try{fs.writeFileSync('/tmp/vk-speed-state/proxy-diag.json',JSON.stringify(stats),{mode:384});}catch(e){}}
  function register(value){
    if(!allowed(value))throw Error('unapproved media host');
    if(reverse[value])return prefix+'media/'+reverse[value];
    if(Object.keys(entries).length>=8192)throw Error('too many media resources');
    var id=crypto.randomBytes(12).toString('hex');entries[id]=value;reverse[value]=id;return prefix+'media/'+id;
  }
  function manifest(text,base){
    if(text.indexOf('#EXTM3U')!==0||/#EXT-X-(?:SESSION-)?KEY:.*METHOD=(?!NONE)/i.test(text))throw Error('unsupported playlist');
    return text.split(/\r?\n/).map(function(line){
      if(!line)return line;
      if(line.charAt(0)==='#')return line.replace(/URI="([^"\r\n]+)"/g,function(all,ref){return 'URI="'+register(url.resolve(base,ref))+'"';});
      return register(url.resolve(base,line.trim()));
    }).join('\n');
  }
  function handle(req,res,id){
    var target=entries[id];if(!target||active>=8){res.writeHead(404);return res.end();}
    var p=url.parse(target),range=req.headers.range;
    if(range&&!/^bytes=\d+-\d*$/.test(range)){res.writeHead(400);return res.end();}
    active++;var complete=false,upstream=null,timer=null;
    function finish(){if(complete)return;complete=true;active--;if(timer)clearTimeout(timer);}
    function fail(reason){if(complete)return;stats.failures++;diag(typeof reason==='string'?reason:'network');if(upstream)upstream.abort();if(!res.headersSent)res.writeHead(502);try{res.end();}catch(e){}finish();}
    res.on('close',function(){if(!complete&&upstream)upstream.abort();finish();});
    timer=setTimeout(function(){fail('timeout');},20000);
    dns.lookup(p.hostname,4,function(err,ip){
      if(complete)return;if(err||!publicIPv4(ip))return fail('dns');
      var headers={'Host':p.host,'User-Agent':'Mozilla/5.0'};if(range)headers.Range=range;
      var opts={hostname:ip,port:p.protocol==='https:'?443:80,path:p.path,method:'GET',headers:headers,agent:false,servername:p.hostname};
      upstream=(p.protocol==='https:'?https:http).request(opts,function(remote){
        if(remote.statusCode!==200&&remote.statusCode!==206){remote.resume();return fail('http-'+remote.statusCode);}
        var type=String(remote.headers['content-type']||'').split(';')[0].toLowerCase();
        var playlist=/mpegurl/.test(type)||/\.m3u8$/i.test(p.pathname||'');
        if(playlist){
          var parts=[],size=0;remote.on('data',function(chunk){size+=chunk.length;if(size>2097152){remote.destroy();return fail();}parts.push(chunk);});
          remote.on('end',function(){if(complete)return;try{var out=manifest(Buffer.concat(parts).toString('utf8'),target);stats.manifests++;diag('playlist');res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store'});res.end(out);finish();}catch(e){fail('playlist-policy');}});
        }else{
          var h={'Content-Type':type||'application/octet-stream','Cache-Control':'no-store'};
          if(remote.headers['content-length'])h['Content-Length']=remote.headers['content-length'];
          if(remote.headers['content-range'])h['Content-Range']=remote.headers['content-range'];
          if(remote.headers['accept-ranges'])h['Accept-Ranges']=remote.headers['accept-ranges'];
          res.writeHead(remote.statusCode,h);var bytes=0;remote.on('data',function(chunk){bytes+=chunk.length;if(bytes>67108864)fail('size');});remote.on('end',function(){stats.segments++;diag('segment');finish();});remote.pipe(res);
        }
        remote.on('error',fail);
      });
      upstream.on('error',fail);upstream.end();
    });
  }
  return {source:register(initial),handle:handle};
}
module.exports={create:create,allowed:allowed,publicIPv4:publicIPv4};
