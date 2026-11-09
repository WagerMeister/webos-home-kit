#define KICK_INPUT_UNIT_TEST
#include "key-bridge.c"
extern int puts(const char *);extern void exit(int);
static unsigned int fake_ms=10000;static int forwarded,sent,fail_send;
int clock_gettime(int ignored,struct timespec *t){(void)ignored;t->sec=fake_ms/1000;t->nsec=(fake_ms%1000)*1000000;return 0;}
long send(int descriptor,const void *bytes,size_t length,int flags){(void)descriptor;(void)bytes;(void)flags;sent++;return fail_send?-1:(long)length;}
const char *wl_proxy_get_class(struct wl_proxy *proxy){(void)proxy;return "wl_keyboard";}
u32 wl_proxy_get_version(struct wl_proxy *proxy){(void)proxy;return 4;}
static void original(void *data,struct wl_proxy *proxy,u32 serial,u32 time,u32 key,u32 state){(void)data;(void)proxy;(void)serial;(void)time;(void)key;(void)state;forwarded++;}
static void check(int value,const char *message){if(!value){puts(message);exit(1);}}
static volatile u32 words[2];
static void setup(void){int i;for(i=0;i<12;i++)entries[i].proxy=0;entries[0].proxy=(struct wl_proxy *)1;entries[0].original[3]=(void *)original;reset_keys(entries);words[0]=0x4b43494b;words[1]=fake_ms;lease_words=words;fd=77;nonce[0]='a';forwarded=sent=fail_send=0;}
static void key(u32 code,u32 state){keyboard_key(0,(struct wl_proxy *)1,0,0,code,state);}
int main(void){u32 passthrough[]={102,113,114,115,116,999};int i;
 setup();key(108,1);key(108,0);check(sent==1&&forwarded==0,"Fresh managed pair not consumed");
 setup();key(108,1);fake_ms+=1601;key(108,0);key(108,1);key(108,0);check(sent==1&&forwarded==2,"Stale lease did not preserve pairing/fail open");
 setup();fail_send=1;key(108,1);key(108,0);check(forwarded==2&&fd==-1&&!lease_words,"IPC failure did not forward pair");
 setup();words[1]=0;key(412,1);key(412,0);check(forwarded==2,"Unleased Back must forward");
 for(i=0;i<6;i++){setup();key(passthrough[i],1);key(passthrough[i],0);check(forwarded==2&&sent==0,"System/unknown key intercepted");words[1]=0;key(passthrough[i],1);key(passthrough[i],0);check(forwarded==4,"Unleased system key intercepted");}
 setup();for(i=0;i<100;i++)key(108,1);key(108,0);check(sent==100&&forwarded==0,"Held-key repeats/pairing failed");
 setup();key(108,1);reset_keys(entries);check(entries[0].swallowed[108]==0,"Focus reset retained consumed key");
 setup();key(108,1);entries[1].proxy=(struct wl_proxy *)2;entries[1].original[3]=(void *)original;keyboard_key(0,(struct wl_proxy *)2,0,0,108,0);check(forwarded==1&&entries[0].swallowed[108]==1,"Keyboard state leaked across proxies");key(108,0);check(forwarded==1,"Matching original keyboard release leaked");
 puts("PASS: managed pairs/repeats; lease expiry and failed IPC fail-open; Home/power/volume/unknown pass-through; focus reset and per-keyboard isolation.");return 0;}
