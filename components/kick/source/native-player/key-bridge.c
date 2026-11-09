/* Kick's own native process only. Never hooks inputd or other applications. */
typedef unsigned int u32;
typedef unsigned int size_t;
struct wl_proxy;
struct timespec { long sec,nsec; };
struct addr { unsigned short family; char path[108]; };
extern void *dlsym(void *,const char *);
extern int strcmp(const char *,const char *);
extern int strncmp(const char *,const char *,size_t);
extern char *strstr(const char *,const char *);
extern int open(const char *,int,...),close(int),getpid(void),socket(int,int,int),connect(int,const void *,unsigned int);
extern long write(int,const void *,size_t);
extern long read(int,void *,size_t),send(int,const void *,size_t,int),lseek(int,long,int);
extern void *mmap(void *,size_t,int,int,int,long);
extern int snprintf(char *,size_t,const char *,...),clock_gettime(int,struct timespec *);
extern const char *wl_proxy_get_class(struct wl_proxy *);
extern u32 wl_proxy_get_version(struct wl_proxy *);
__attribute__((visibility("default"))) const char kick_app_id[] __asm__("_ZN4crow13kBrowserAppIdE")="com.jakubjirak.player";
struct entry { struct wl_proxy *proxy; void (*original[6])(void);void (*wrapped[6])(void);unsigned char swallowed[768]; };
static struct entry entries[12];
static char nonce[33];static int fd=-1;static volatile u32 *lease_words;
static u32 ms(void){struct timespec t;if(clock_gettime(1,&t))return 0;return (u32)t.sec*1000u+(u32)t.nsec/1000000u;}
static int hex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
static int message(char type,u32 value){char b[64];int n;long sent;if(fd<0)return 0;n=snprintf(b,sizeof b,"%c%s:%u\n",type,nonce,value);if(n<=0||n>=(int)sizeof b)return 0;sent=send(fd,b,(size_t)n,16384);if(sent==n)return 1;close(fd);fd=-1;lease_words=0;return 0;}
static int lease(void){u32 stamp;if(!lease_words||lease_words[0]!=0x4b43494bu)return 0;stamp=lease_words[1];return stamp&&(u32)(ms()-stamp)<=1500u;}
static int managed(u32 key){return key==1||key==28||key==96||key==103||key==105||key==106||key==108||key==158||key==412||key==358||key==119||key==164||key==168||key==207||key==208;}
__attribute__((constructor)) static void initialize(void){
 char b[8192],state_path[100],*p;int in,n,i;void *mapping;struct addr a={1,{0}};
 in=open("/proc/self/cmdline",0|524288);if(in<0)return;n=(int)read(in,b,sizeof b-1);close(in);if(n<=0)return;
 for(i=0;i<n;i++)if(!b[i])b[i]=' ';b[n]=0;
 if(strstr(b,"--type="))return;p=strstr(b,"http://127.0.0.1:18427/");if(!p)return;p+=23;
 if((b+n)-p<43)return;for(i=0;i<32;i++){if(hex(p[i])<0)return;nonce[i]=p[i];}nonce[32]=0;
 if(strncmp(p+32,"/index.html",11))return;
 snprintf(state_path,sizeof state_path,"/tmp/kick-control-%s/lease",nonce);
 in=open(state_path,0|2048|32768|524288);if(in<0)return;
 if(lseek(in,0,2)!=8){close(in);return;}mapping=mmap(0,8,1,1,in,0);close(in);if(mapping==(void *)-1)return;lease_words=(volatile u32 *)mapping;
 snprintf(a.path,sizeof a.path,"/tmp/kick-control-%s/socket",nonce);
 fd=socket(1,1|2048|524288,0);if(fd<0){lease_words=0;return;}
 if(connect(fd,&a,sizeof a)){close(fd);fd=-1;return;}message('H',(u32)getpid());
}
static struct entry *entry_for(struct wl_proxy *proxy){int i;for(i=0;i<12;i++)if(entries[i].proxy==proxy)return &entries[i];return 0;}
static void reset_keys(struct entry *entry){int j;if(entry)for(j=0;j<768;j++)entry->swallowed[j]=0;}
static void keyboard_enter(void *data,struct wl_proxy *proxy,u32 serial,void *surface,void *keys){struct entry *e=entry_for(proxy);if(e){void (*fn)(void *,struct wl_proxy *,u32,void *,void *)=(void *)e->original[1];reset_keys(e);if(fn)fn(data,proxy,serial,surface,keys);}}
static void keyboard_leave(void *data,struct wl_proxy *proxy,u32 serial,void *surface){struct entry *e=entry_for(proxy);if(e){void (*fn)(void *,struct wl_proxy *,u32,void *)=(void *)e->original[2];reset_keys(e);if(fn)fn(data,proxy,serial,surface);}}
static void keyboard_key(void *data,struct wl_proxy *proxy,u32 serial,u32 time,u32 key,u32 state){
 struct entry *entry=entry_for(proxy);int active=managed(key)?lease():0;
 if(!entry)return;
 if(key<768&&managed(key)){
  if(state){if(active&&message('K',key)){entry->swallowed[key]=1;return;}entry->swallowed[key]=0;}
  else if(entry->swallowed[key]){entry->swallowed[key]=0;return;}
 }
 {void (*fn)(void *,struct wl_proxy *,u32,u32,u32,u32)=(void *)entry->original[3];if(fn)fn(data,proxy,serial,time,key,state);}
}
int wl_proxy_add_listener(struct wl_proxy *proxy,void (**listener)(void),void *data){
 static int (*next)(struct wl_proxy *,void (**)(void),void *);const char *cls;int i,j,n,result;
 if(!next)next=(void *)dlsym((void *)-1,"wl_proxy_add_listener");if(!next)return -1;
 cls=wl_proxy_get_class(proxy);

 if(cls&&strcmp(cls,"wl_keyboard")==0&&listener){
  for(i=0;i<12;i++)if(entries[i].proxy==proxy)return next(proxy,listener,data);
  for(i=0;i<12&&entries[i].proxy;i++){/* Find a free slot. */}if(i==12)return next(proxy,listener,data);
  n=wl_proxy_get_version(proxy)>=4?6:5;entries[i].proxy=proxy;reset_keys(&entries[i]);
  for(j=0;j<n;j++)entries[i].original[j]=entries[i].wrapped[j]=listener[j];entries[i].wrapped[1]=(void *)keyboard_enter;entries[i].wrapped[2]=(void *)keyboard_leave;entries[i].wrapped[3]=(void *)keyboard_key;
  result=next(proxy,entries[i].wrapped,data);if(result)entries[i].proxy=0;return result;
 }
 return next(proxy,listener,data);
}
void wl_proxy_destroy(struct wl_proxy *proxy){
 static void (*next)(struct wl_proxy *);int i;if(!next)next=(void *)dlsym((void *)-1,"wl_proxy_destroy");
 for(i=0;i<12;i++)if(entries[i].proxy==proxy){reset_keys(&entries[i]);entries[i].proxy=0;}if(next)next(proxy);
}
#ifndef KICK_INPUT_UNIT_TEST
/* CBE79 on this TV uses the legacy shell property, not set_key_mask.
 * Change only our window's Back policy; preserve Home/power/volume policy. */
struct message_info { const char *name,*signature;const void **types; };
struct interface_info {const char *name;int version,count;const struct message_info *methods;int event_count;const struct message_info *events;};
void *kick_prepare_marshal(u32 *args){
 static void *next;static const struct interface_info *interface;const char *cls;u32 opcode=args[1];
 if(!next)next=dlsym((void *)-1,"wl_proxy_marshal");
 if(!nonce[0])return next;
 cls=wl_proxy_get_class((struct wl_proxy *)args[0]);
 if(cls&&strcmp(cls,"wl_webos_shell_surface")==0){
  if(!interface)interface=(const struct interface_info *)dlsym(0,"wl_webos_shell_surface_interface");
  if(interface&&opcode<(u32)interface->count&&interface->count<128){
   const struct message_info *m=interface->methods+opcode;
   if(m->name&&m->signature&&strcmp(m->name,"set_property")==0&&strcmp(m->signature,"ss")==0&&args[2]){
    if(strcmp((const char *)args[2],"_WEBOS_ACCESS_POLICY_KEYS_BACK")==0)args[3]=(u32)"true";
    else if(strcmp((const char *)args[2],"title")==0)args[3]=(u32)"Kick Replay";
   }
  }
 }
 return next;
}
/* AAPCS32: preserve r0-r3 (including varargs) and the original stack arguments,
 * keep SP aligned8 across the C helper, then tail-call the original function. */
__attribute__((naked)) void wl_proxy_marshal(struct wl_proxy *proxy,u32 opcode,...){
 __asm__ volatile("push {r0-r3,r12,lr}\nmov r0,sp\nbl kick_prepare_marshal\nstr r0,[sp,#16]\npop {r0-r3,r12,lr}\nbx r12\n");
}
#endif
