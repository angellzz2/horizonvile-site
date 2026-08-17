const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'store.json');
const BOT_SETTINGS_DEFAULT_FILE = path.join(ROOT, 'data', 'bot-settings-default.json');
const PORT = Number(process.env.PORT || 3000);

const ADMIN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || 'dev-secret-change-me');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'troque-esta-senha');
const ADMIN_PANEL_PASSWORD = String(process.env.ADMIN_PANEL_PASSWORD || ADMIN_PASSWORD);
const BOT_PANEL_PASSWORD = String(process.env.BOT_PANEL_PASSWORD || 'troque-esta-senha-bot');
const OWNER_DISCORD_ID = String(process.env.OWNER_DISCORD_ID || '980286104852914257');
const MTA_API_KEY = String(process.env.MTA_API_KEY || 'dev-mta-key-change-me');
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || 'demo');
const HV_STORE_BOT_API_KEY = String(process.env.HV_STORE_BOT_API_KEY || process.env.HV_BOT_API_KEY || '').trim();
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || 'https://horizonville.cc').replace(/\/+$/, '');
const BACKEND_PUBLIC_URL = String(process.env.BACKEND_PUBLIC_URL || 'https://horizonville-backend.onrender.com').replace(/\/+$/, '');
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_REDIRECT_URI = String(process.env.DISCORD_REDIRECT_URI || `${BACKEND_PUBLIC_URL}/api/auth/discord/callback`).trim();
const DISCORD_INVITE_URL = String(process.env.DISCORD_INVITE_URL || 'https://discord.gg/horizonville').trim();
const ALLOWLIST_CODE_TTL_MS = Math.max(5, Number(process.env.ALLOWLIST_CODE_TTL_MINUTES || 30)) * 60 * 1000;
const ID_CHECK_TTL_MS = 5 * 60 * 1000;
const ID_CHECK_PENDING_TTL_MS = 30 * 1000;

const LICENSE_API_URL = String(process.env.LICENSE_API_URL || '').trim().replace(/\/+$/, '');
const LICENSE_ADMIN_KEY = String(process.env.LICENSE_ADMIN_KEY || process.env.HV_ADMIN_API_KEY || process.env.HV_BOT_API_KEY || '').trim();
const CORS_VERSION = 'hv-cors-v7-discord-control';
let lastMtaSeenAt = null;

const MIME = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.txt':'text/plain; charset=utf-8'
};

function nowIso(){ return new Date().toISOString(); }
function randomId(bytes=18){ return crypto.randomBytes(bytes).toString('hex'); }
function cleanId(v){ return String(v || '').replace(/\D/g,'').slice(0,24); }
function safeText(v, max=500){ return String(v ?? '').trim().slice(0,max); }
function normalizeAccount(v){ return String(v||'').trim(); }
function sameAccount(a,b){ return normalizeAccount(a).toLowerCase()===normalizeAccount(b).toLowerCase(); }
function toBool(v){ if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;return ['1','true','sim','yes','on'].includes(String(v??'').trim().toLowerCase()); }
function isPaidStatus(status){ const s=String(status||'').toLowerCase(); return s.startsWith('approved') || ['paid','received','confirmed'].includes(s); }
function secureEqual(a,b){ const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b)); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
function json(res,status,data){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); }
function redirect(res, url){ res.writeHead(302,{Location:url,'Cache-Control':'no-store'});res.end(); }
function body(req){ return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>8e6){reject(new Error('Corpo muito grande.'));req.destroy();}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);}); }
function sign(payload){ const raw=Buffer.from(JSON.stringify(payload)).toString('base64url');const sig=crypto.createHmac('sha256',ADMIN_SECRET).update(raw).digest('base64url');return `${raw}.${sig}`; }
function verify(token){ try{const [raw,sig]=String(token||'').split('.');if(!raw||!sig)return null;const exp=crypto.createHmac('sha256',ADMIN_SECRET).update(raw).digest('base64url');if(!secureEqual(sig,exp))return null;const p=JSON.parse(Buffer.from(raw,'base64url').toString());if(p.exp&&p.exp<Date.now())return null;return p;}catch{return null;} }
function bearer(req){ return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim(); }
function userSession(req){ const p=verify(bearer(req)); return p?.typ==='user' ? p : null; }
function panelSession(req, panel){ const p=verify(bearer(req)); return p?.typ==='panel' && p.panel===panel ? p : null; }
function isMTA(req){ const ok=(req.headers.authorization||'')===`Bearer ${MTA_API_KEY}` || String(req.headers['x-hv-mta-key']||'')===MTA_API_KEY;if(ok)lastMtaSeenAt=nowIso();return ok; }
function isStoreBot(req){ return !!HV_STORE_BOT_API_KEY && secureEqual(String(req.headers['x-hv-bot-key']||''),HV_STORE_BOT_API_KEY); }

function addCors(req,res){
  const requested = String(req?.headers?.['access-control-request-headers'] || '').split(',').map(x=>x.trim()).filter(Boolean);
  const allowHeaders=[...new Set(['Content-Type','Authorization','X-HV-ADMIN-KEY','X-HV-BOT-KEY','X-HV-MTA-KEY','Cache-Control',...requested])].join(', ');
  const headers={
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':allowHeaders,'Access-Control-Max-Age':'86400','Access-Control-Expose-Headers':'X-HV-CORS-Version',
    'Vary':'Access-Control-Request-Headers, Access-Control-Request-Method','X-HV-CORS-Version':CORS_VERSION
  };
  for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
}

function defaultBotControl(){
  let legacySettings={};
  try{ if(fs.existsSync(BOT_SETTINGS_DEFAULT_FILE)) legacySettings=JSON.parse(fs.readFileSync(BOT_SETTINGS_DEFAULT_FILE,'utf8')); }catch{}
  const questions=Array.from({length:10},(_,i)=>({
    id:`q${i+1}`, question:`Pergunta ${i+1} — edite esta pergunta no Painel do Bot`,
    options:['Alternativa A','Alternativa B','Alternativa C','Alternativa D'], correctIndex:0, enabled:true
  }));
  return {
    revision:1,
    settings:{
      welcome:{enabled:false,channelId:'',title:'👋 Bem-vindo(a)!',description:'Olá {user}, seja muito bem-vindo(a) ao **HorizonVille!**\n\n📋 **Leia as Regras**\nConfira as regras antes de começar.\n\n🎉 **Interaja**\nParticipe da comunidade e divirta-se!',color:'#5865F2',footer:'Agora somos {members} membros!',showAvatar:true},
      serverStatus:{enabled:false,channelId:'',messageId:'',title:'HORIZONVILLE',description:'Acompanhe o status do servidor em tempo real.',colorOnline:'#57F287',colorOffline:'#ED4245',connectUrl:'',buttonLabel:'😎 Conecte-se!',image:''},
      allowlist:{enabled:true,panelChannelId:'',panelMessageId:'',ticketCategoryId:'',approvedChannelId:'',staffReviewChannelId:'',staffRoleIds:[],approvedRoleId:'',title:'🪪 LIBERAÇÃO HORIZONVILLE',description:'Para entrar no servidor, realize sua Allowlist.',buttonLabel:'Realizar Allowlist',buttonEmoji:'🪪',color:'#5865F2',minScore:8,questionCount:10,closeSeconds:5,approvalMode:'auto',questions},
      purchaseLogs:{enabled:true,channelId:''},
      commands:{perfil:true,mensagem:true,cargotodos:true,painel:true,paineldenuncias:true,painelconta:true,licenca:true}
    },
    legacySettings,
    actions:[]
  };
}

function ensureStoreShape(db){
  if(!db||typeof db!=='object')db={};
  for(const key of ['orders','products','coupons','idChecks','authorizedUsers','authExchanges','auditLogs'])if(!Array.isArray(db[key]))db[key]=[];
  if(!db.botControl||typeof db.botControl!=='object')db.botControl=defaultBotControl();
  const def=defaultBotControl();
  const currentSettings=db.botControl.settings||{};
  db.botControl.settings={
    ...def.settings,
    ...currentSettings,
    welcome:{...def.settings.welcome,...(currentSettings.welcome||{})},
    serverStatus:{...def.settings.serverStatus,...(currentSettings.serverStatus||{})},
    allowlist:{...def.settings.allowlist,...(currentSettings.allowlist||{})},
    purchaseLogs:{...def.settings.purchaseLogs,...(currentSettings.purchaseLogs||{})},
    commands:{...def.settings.commands,...(currentSettings.commands||{})},
  };
  if(!Array.isArray(db.botControl.settings.allowlist.questions)||!db.botControl.settings.allowlist.questions.length) db.botControl.settings.allowlist.questions=def.settings.allowlist.questions;
  // Migração V7: ativa a Allowlist uma única vez após atualização. Depois disso, o Painel do Bot pode ligar/desligar normalmente.
  if(db.botControl.allowlistEnabledMigrationV7!==true){db.botControl.settings.allowlist.enabled=true;db.botControl.allowlistEnabledMigrationV7=true;}
  if(!Array.isArray(db.botControl.actions))db.botControl.actions=[];
  if(!Number.isInteger(db.botControl.revision))db.botControl.revision=1;
  if(!db.allowlist||typeof db.allowlist!=='object')db.allowlist={};
  for(const key of ['codes','attempts','bindings'])if(!Array.isArray(db.allowlist[key]))db.allowlist[key]=[];
  if(!db.serverStatus||typeof db.serverStatus!=='object')db.serverStatus={online:false,updatedAt:null,players:0,maxPlayers:0,name:'HorizonVille Roleplay'};
  for(const p of db.products){if(isCustomIdProduct(p)){p.productType='custom_id';p.exclusive=false;p.stock=0;}else{p.exclusive=toBool(p.exclusive);p.limited=toBool(p.limited);}if(p.active===undefined||p.active===null||p.active==='')p.active=true;else p.active=toBool(p.active);}
  const now=Date.now();
  db.idChecks=db.idChecks.filter(x=>now-new Date(x.createdAt||0).getTime()<10*60*1000&&!x.consumedAt);
  db.authExchanges=db.authExchanges.filter(x=>!x.usedAt&&x.expiresAt>now);
  db.allowlist.codes=db.allowlist.codes.filter(x=>!x.expiresAt || x.expiresAt>now-24*60*60*1000);
  db.botControl.actions=db.botControl.actions.filter(x=>!x.ackedAt && now-new Date(x.createdAt||0).getTime()<24*60*60*1000);
  return db;
}
function loadDB(){ fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});if(!fs.existsSync(DATA_FILE))fs.writeFileSync(DATA_FILE,JSON.stringify(ensureStoreShape({}),null,2));return ensureStoreShape(JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))); }
function saveDB(db){ fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(ensureStoreShape(db),null,2)); }

function audit(db, discordId, event, detail={}){ db.auditLogs.unshift({id:randomId(8),at:nowIso(),discordId:String(discordId||''),event,safeDetail:detail});db.auditLogs=db.auditLogs.slice(0,1000); }
function accessFor(db, discordId){ const id=String(discordId||'');if(id===OWNER_DISCORD_ID)return {discordId:id,admin:true,bot:true,role:'owner'};const entry=db.authorizedUsers.find(x=>String(x.discordId)===id);return entry ? {...entry,admin:!!entry.admin,bot:!!entry.bot} : {discordId:id,admin:false,bot:false,role:'none'}; }
function requireUser(req,res){ const u=userSession(req);if(!u){json(res,401,{ok:false,code:'DISCORD_LOGIN_REQUIRED',message:'Conecte sua conta do Discord para continuar.'});return null;}return u; }
function requirePanel(req,res,panel){ const p=panelSession(req,panel);if(!p){json(res,401,{ok:false,message:'Sessão do painel inválida ou expirada.'});return null;}const db=loadDB(),access=accessFor(db,p.discordId);if(panel==='admin'&&!access.admin){json(res,403,{ok:false,message:'Seu Discord não possui acesso ao Painel Administrativo.'});return null;}if(panel==='bot'&&!access.bot){json(res,403,{ok:false,message:'Seu Discord não possui acesso ao Painel do Bot.'});return null;}return p; }
function makeUserToken(user){ return sign({typ:'user',discordId:String(user.id),username:user.username||'',globalName:user.global_name||user.username||'',avatar:user.avatar||'',email:user.email||'',exp:Date.now()+7*24*60*60*1000}); }
function avatarUrl(user){ return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : 'https://cdn.discordapp.com/embed/avatars/0.png'; }
function sanitizeReturnPath(value){ try{const u=new URL(value,SITE_ORIGIN);if(u.origin!==new URL(SITE_ORIGIN).origin)return '/';return u.pathname+u.search+u.hash;}catch{return '/';} }

function isCustomIdProduct(p){ if(!p)return false;if(String(p.productType||'').toLowerCase()==='custom_id')return true;const name=String(p.name||'').trim().toLowerCase(),text=`${p.name||''} ${p.badge||''} ${p.description||''}`.toLowerCase();return name==='id'||name==='id personalizado'||name==='id personalizável'||name==='id personalizavel'||/(^|\b)id\s*personalizad[oa](\b|$)/i.test(text)||/compra\s+de\s+id/i.test(text); }
function safeProduct(p){const custom=isCustomIdProduct(p);return {id:p.id,name:p.name,price:p.price,category:p.category,badge:p.badge,icon:p.icon,description:p.description,active:p.active!==false,exclusive:custom?false:toBool(p.exclusive),bonus:p.bonus||'',limited:custom?false:toBool(p.limited),stock:custom?0:Math.max(0,Number(p.stock)||0),image:p.image||'',productType:custom?'custom_id':'normal'};}
function couponValid(c){if(!c||!c.active)return false;if(c.maxUses&&c.uses>=c.maxUses)return false;if(c.expiresAt&&new Date(c.expiresAt+'T23:59:59')<new Date())return false;return true;}
function orderTotals(items,couponCode){const db=loadDB(),cart=[];let subtotal=0,estimatedCost=0;for(const item of items||[]){const p=db.products.find(x=>x.id===item.id&&x.active!==false);if(!p)continue;const productType=isCustomIdProduct(p)?'custom_id':'normal';let qty=productType==='custom_id'?1:Math.max(1,Math.min(20,Number(item.qty)||1));if(productType!=='custom_id'&&toBool(p.limited)){const available=Math.max(0,Number(p.stock)||0);qty=Math.min(qty,available);if(qty<=0)continue;}cart.push({id:p.id,name:p.name,price:p.price,qty,category:p.category,bonus:p.bonus||'',exclusive:productType==='custom_id'?false:toBool(p.exclusive),limited:productType==='custom_id'?false:toBool(p.limited),productType});subtotal+=Number(p.price||0)*qty;estimatedCost+=(Number(p.costPrice)||0)*qty;}let coupon=null,discount=0;if(couponCode){coupon=db.coupons.find(c=>String(c.code).toUpperCase()===String(couponCode).trim().toUpperCase());if(couponValid(coupon))discount=+(subtotal*(coupon.discount/100)).toFixed(2);else coupon=null;}const total=+Math.max(0,subtotal-discount).toFixed(2);return {cart,subtotal:+subtotal.toFixed(2),discount,total,coupon,estimatedCost:+estimatedCost.toFixed(2),estimatedProfit:+Math.max(0,total-estimatedCost).toFixed(2)};}

function statsFor(db){ const paid=db.orders.filter(o=>isPaidStatus(o.paymentStatus));const gross=paid.reduce((a,o)=>a+Number(o.total||0),0);const profit=paid.reduce((a,o)=>a+Number(o.estimatedProfit||0),0);const discount=paid.reduce((a,o)=>a+Number(o.discount||0),0);const today=new Date().toISOString().slice(0,10);const month=today.slice(0,7);const todayOrders=paid.filter(o=>String(o.createdAt||'').slice(0,10)===today);const monthOrders=paid.filter(o=>String(o.createdAt||'').slice(0,7)===month);const counts={};for(const o of paid)for(const i of o.items||[])counts[i.name]=(counts[i.name]||0)+Number(i.qty||1);return {totalSales:paid.length,grossRevenue:+gross.toFixed(2),estimatedProfit:+profit.toFixed(2),discounts:+discount.toFixed(2),averageTicket:paid.length?+(gross/paid.length).toFixed(2):0,pendingPayments:db.orders.filter(o=>String(o.paymentStatus)==='pending').length,todaySales:todayOrders.length,todayRevenue:+todayOrders.reduce((a,o)=>a+Number(o.total||0),0).toFixed(2),monthSales:monthOrders.length,monthRevenue:+monthOrders.reduce((a,o)=>a+Number(o.total||0),0).toFixed(2),topProducts:Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,qty])=>({name,qty}))}; }

async function licenseApi(pathname, options={}){
  if(!LICENSE_API_URL||!LICENSE_ADMIN_KEY){const e=new Error('Central de licenças não configurada no backend.');e.status=503;throw e;}
  let response;try{response=await fetch(LICENSE_API_URL+pathname,{...options,headers:{'Content-Type':'application/json','X-HV-ADMIN-KEY':LICENSE_ADMIN_KEY,'X-HV-BOT-KEY':LICENSE_ADMIN_KEY,...(options.headers||{})}});}catch{const e=new Error('Não foi possível conectar à API de licenças.');e.status=502;throw e;}
  let data={};try{data=await response.json();}catch{data={ok:false,message:'Resposta inválida da API de licenças.'};}
  if(!response.ok){const e=new Error(response.status===401?'A chave da central de licenças não confere.':(data.message||'Falha na API de licenças.'));e.status=response.status===401?502:response.status;throw e;}return data;
}

function createAllowlistCode(db, serial, nickname){
  const now=Date.now();for(const c of db.allowlist.codes){if(c.serial===serial&&!c.usedAt&&!c.invalidatedAt)c.invalidatedAt=nowIso();}
  const chunk=()=>crypto.randomBytes(3).toString('hex').toUpperCase().slice(0,4);const code=`HV-${chunk()}-${chunk()}`;
  const entry={code,serial,nickname:safeText(nickname,64),createdAt:nowIso(),expiresAt:now+ALLOWLIST_CODE_TTL_MS,usedAt:null,invalidatedAt:null,discordId:null};db.allowlist.codes.push(entry);return entry;
}
function approvedBindingBySerial(db,serial){return db.allowlist.bindings.find(x=>x.serial===serial&&x.status==='approved');}
function upsertApprovedBinding(db, {serial,discordId,attemptId}){let b=db.allowlist.bindings.find(x=>x.serial===serial||x.discordId===discordId);if(!b){b={id:randomId(10),serial,discordId,status:'approved',approvedAt:nowIso(),attemptId,gameLogin:null,gameId:null,linkedAt:null};db.allowlist.bindings.push(b);}else{b.serial=serial;b.discordId=discordId;b.status='approved';b.approvedAt=nowIso();b.attemptId=attemptId;}return b;}
function publicQuestion(cfg,index){const q=cfg.questions[index];return q?{index,total:Math.min(Number(cfg.questionCount||10),cfg.questions.length),question:q.question,options:q.options}:null;}

async function api(req,res,url){
  const pathname=url.pathname;
  if(req.method==='GET'&&pathname==='/api/health')return json(res,200,{ok:true,service:'horizonville-store-api',build:'v7-discord-control',corsVersion:CORS_VERSION});
  if(req.method==='GET'&&pathname==='/api/config')return json(res,200,{paymentMode:PAYMENT_MODE,build:'v7-discord-control',discordLoginConfigured:!!(DISCORD_CLIENT_ID&&DISCORD_CLIENT_SECRET)});
  if(req.method==='GET'&&pathname==='/api/id-system/status')return json(res,200,{ok:true,mtaSeen:!!lastMtaSeenAt,lastMtaSeenAt});
  if(req.method==='GET'&&pathname==='/api/network-test')return json(res,200,{ok:true,time:nowIso(),corsVersion:CORS_VERSION});

  // Discord OAuth2: Authorization Code Grant + identify/email.
  if(req.method==='GET'&&pathname==='/api/auth/discord/start'){
    if(!DISCORD_CLIENT_ID||!DISCORD_CLIENT_SECRET)return json(res,503,{ok:false,message:'Login com Discord ainda não foi configurado no backend.'});
    const returnPath=sanitizeReturnPath(url.searchParams.get('returnTo')||'/');
    const state=sign({typ:'oauth-state',returnPath,exp:Date.now()+10*60*1000});
    const q=new URLSearchParams({client_id:DISCORD_CLIENT_ID,response_type:'code',redirect_uri:DISCORD_REDIRECT_URI,scope:'identify email',state});
    return redirect(res,`https://discord.com/oauth2/authorize?${q.toString()}`);
  }
  if(req.method==='GET'&&pathname==='/api/auth/discord/callback'){
    const state=verify(url.searchParams.get('state'));const code=url.searchParams.get('code');
    if(!state||state.typ!=='oauth-state'||!code)return redirect(res,`${SITE_ORIGIN}/auth.html?error=oauth_invalido`);
    try{
      const form=new URLSearchParams({client_id:DISCORD_CLIENT_ID,client_secret:DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:DISCORD_REDIRECT_URI});
      const tr=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});const td=await tr.json();if(!tr.ok||!td.access_token)throw new Error('Falha ao trocar código OAuth.');
      const ur=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${td.access_token}`}});const user=await ur.json();if(!ur.ok||!user.id)throw new Error('Falha ao consultar usuário do Discord.');
      const db=loadDB(),exchange=randomId(24);db.authExchanges.push({code:exchange,user:{id:user.id,username:user.username,global_name:user.global_name,avatar:user.avatar,email:user.email||''},expiresAt:Date.now()+2*60*1000,usedAt:null});saveDB(db);
      return redirect(res,`${SITE_ORIGIN}/auth.html?code=${encodeURIComponent(exchange)}&next=${encodeURIComponent(state.returnPath||'/')}`);
    }catch(e){console.error('OAuth Discord:',e);return redirect(res,`${SITE_ORIGIN}/auth.html?error=discord`);}
  }
  if(req.method==='POST'&&pathname==='/api/auth/discord/exchange'){
    const b=await body(req),db=loadDB(),x=db.authExchanges.find(v=>v.code===String(b.code||'')&&!v.usedAt&&v.expiresAt>Date.now());if(!x)return json(res,400,{ok:false,message:'Login expirado. Conecte o Discord novamente.'});x.usedAt=nowIso();saveDB(db);return json(res,200,{ok:true,token:makeUserToken(x.user)});
  }
  if(req.method==='GET'&&pathname==='/api/account/me'){
    const u=requireUser(req,res);if(!u)return;const db=loadDB(),access=accessFor(db,u.discordId),binding=db.allowlist.bindings.find(x=>x.discordId===u.discordId&&x.status==='approved');return json(res,200,{ok:true,user:{discordId:u.discordId,username:u.username,displayName:u.globalName||u.username,avatar:u.avatar?`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=128`:'https://cdn.discordapp.com/embed/avatars/0.png',email:u.email||''},game:binding?{whitelist:'approved',login:binding.gameLogin||null,id:binding.gameId??null,linkedAt:binding.linkedAt||null}:{whitelist:'not_linked',login:null,id:null},access:{admin:access.admin,bot:access.bot,role:access.role}});
  }
  if(req.method==='GET'&&pathname==='/api/account/orders'){
    const u=requireUser(req,res);if(!u)return;const db=loadDB();return json(res,200,{ok:true,orders:db.orders.filter(o=>String(o.discordId||'')===u.discordId).slice(0,100)});
  }

  if(req.method==='GET'&&pathname==='/api/products'){const db=loadDB();return json(res,200,{products:db.products.filter(p=>p.active!==false).map(safeProduct)});}
  if(req.method==='POST'&&pathname==='/api/coupons/validate'){const b=await body(req),totals=orderTotals(b.items,b.code);if(!totals.coupon)return json(res,404,{ok:false,message:'Cupom inválido, expirado ou indisponível.'});return json(res,200,{ok:true,code:totals.coupon.code,discountPercent:totals.coupon.discount,subtotal:totals.subtotal,discount:totals.discount,total:totals.total});}

  // Verificação de ID existente (mantida compatível com o resource atual).
  if(req.method==='POST'&&pathname==='/api/id-checks'){
    const b=await body(req),account=normalizeAccount(b.account),desiredId=Number(b.desiredId);if(account.length<2)return json(res,400,{ok:false,message:'Informe a conta do MTA.'});if(!Number.isInteger(desiredId)||desiredId<1||desiredId>999999)return json(res,400,{ok:false,message:'Informe um ID entre 1 e 999999.'});const db=loadDB(),now=Date.now(),clientRequestId=safeText(b.clientRequestId,80);if(clientRequestId){const existing=db.idChecks.find(x=>x.clientRequestId===clientRequestId&&!x.consumedAt&&now-new Date(x.createdAt||0).getTime()<10*60*1000);if(existing)return json(res,existing.status==='pending'?202:200,{ok:true,token:existing.token,status:existing.status,reused:true});}const reserved=db.orders.some(o=>Number(o.desiredId)===desiredId&&o.idDeliveryStatus!=='failed'&&o.idDeliveryStatus!=='cancelled'&&(isPaidStatus(o.paymentStatus)||(o.paymentStatus==='pending'&&now-new Date(o.createdAt).getTime()<30*60*1000)));if(reserved)return json(res,409,{ok:false,message:`O ID ${desiredId} já está reservado em outro pedido.`});const token=crypto.randomBytes(18).toString('hex');db.idChecks.push({token,clientRequestId,account,desiredId,status:'pending',createdAt:nowIso(),updatedAt:nowIso()});saveDB(db);return json(res,202,{ok:true,token,status:'pending'});
  }
  const idCheckPublic=pathname.match(/^\/api\/id-checks\/([a-f0-9]{36})$/);if(idCheckPublic&&req.method==='GET'){const db=loadDB(),x=db.idChecks.find(v=>v.token===idCheckPublic[1]);if(!x)return json(res,404,{ok:false,message:'Verificação não encontrada ou expirada.'});if(Date.now()-new Date(x.createdAt).getTime()>10*60*1000)return json(res,410,{ok:false,message:'Verificação expirada.'});return json(res,200,{ok:true,status:x.status,accountExists:!!x.accountExists,available:x.available===true,oldId:x.oldId??null,message:x.message||''});}

  // Checkout exige Discord autenticado. A identidade do comprador nunca vem de campo manual.
  if(req.method==='POST'&&pathname==='/api/checkout'){
    const u=requireUser(req,res);if(!u)return;const b=await body(req),totals=orderTotals(b.items,b.couponCode);if(!totals.cart.length)return json(res,400,{ok:false,message:'Seu carrinho está vazio.'});const methods=['pix','card','boleto'];if(!methods.includes(b.paymentMethod))return json(res,400,{ok:false,message:'Método de pagamento inválido.'});const db=loadDB(),binding=db.allowlist.bindings.find(x=>x.discordId===u.discordId&&x.status==='approved');const account=binding?.gameLogin||normalizeAccount(b.account);if(!account||account.length<2)return json(res,400,{ok:false,message:'Informe a conta do jogador no MTA.'});
    const idItems=totals.cart.filter(i=>i.productType==='custom_id');let desiredId=null;if(idItems.length){if(idItems.length>1)return json(res,400,{ok:false,message:'Finalize apenas um produto de ID personalizado por pedido.'});desiredId=Number(b.desiredId);if(!Number.isInteger(desiredId)||desiredId<1||desiredId>999999)return json(res,400,{ok:false,message:'Informe um ID desejado entre 1 e 999999.'});}
    const checkoutRequestId=safeText(b.checkoutRequestId,100);if(checkoutRequestId){const existing=db.orders.find(o=>o.checkoutRequestId===checkoutRequestId&&o.discordId===u.discordId);if(existing)return json(res,200,{ok:true,reused:true,order:existing,payment:{mode:PAYMENT_MODE,status:existing.paymentStatus,message:'Pedido já havia sido criado.'}});}
    let verifiedCheck=null;if(desiredId!==null){const token=safeText(b.verificationToken,100),isUsable=x=>x&&!x.consumedAt&&x.status==='done'&&x.available===true&&x.accountExists===true&&sameAccount(x.account,account)&&Number(x.desiredId)===desiredId&&(Date.now()-new Date(x.updatedAt||x.createdAt).getTime()<=ID_CHECK_TTL_MS);verifiedCheck=db.idChecks.find(x=>x.token===token&&!x.consumedAt);if(!isUsable(verifiedCheck))verifiedCheck=db.idChecks.filter(isUsable).sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt))[0]||null;if(!verifiedCheck)return json(res,409,{ok:false,code:'ID_VERIFICATION_REQUIRED',message:'A verificação do ID não está mais válida. Clique em Verificar ID novamente.'});const reserved=db.orders.some(o=>Number(o.desiredId)===desiredId&&o.idDeliveryStatus!=='failed'&&o.idDeliveryStatus!=='cancelled'&&(isPaidStatus(o.paymentStatus)||(o.paymentStatus==='pending'&&Date.now()-new Date(o.createdAt).getTime()<30*60*1000)));if(reserved)return json(res,409,{ok:false,message:`O ID ${desiredId} já está reservado em outro pedido.`});}
    const order={id:'HV'+Date.now().toString(36).toUpperCase()+crypto.randomBytes(2).toString('hex').toUpperCase(),createdAt:nowIso(),account,email:safeText(b.email||u.email,160),discordId:u.discordId,discordUsername:u.username,discordDisplayName:u.globalName||u.username,discord:`<@${u.discordId}>`,gameId:binding?.gameId??null,items:totals.cart,subtotal:totals.subtotal,discount:totals.discount,total:totals.total,couponCode:totals.coupon?.code||null,paymentMethod:b.paymentMethod,paymentStatus:PAYMENT_MODE==='demo'?'approved_demo':'pending',deliveryStatus:'pending',estimatedCost:totals.estimatedCost,estimatedProfit:totals.estimatedProfit,desiredId,checkoutRequestId:checkoutRequestId||null,idDeliveryStatus:desiredId!==null?'pending':null,idDeliveryMessage:'',idOldId:verifiedCheck?.oldId??null,discordPurchaseLoggedAt:null,idDiscordLoggedAt:null};db.orders.unshift(order);if(isPaidStatus(order.paymentStatus)){for(const ci of totals.cart){const pp=db.products.find(x=>x.id===ci.id);if(pp&&pp.productType!=='custom_id'&&toBool(pp.limited))pp.stock=Math.max(0,(Number(pp.stock)||0)-ci.qty);}}if(totals.coupon){const c=db.coupons.find(x=>x.code===totals.coupon.code);c.uses=(c.uses||0)+1;}if(verifiedCheck)verifiedCheck.consumedAt=nowIso();saveDB(db);return json(res,200,{ok:true,order,payment:{mode:PAYMENT_MODE,status:order.paymentStatus,message:PAYMENT_MODE==='demo'?'Compra aprovada em modo de demonstração.':'Pagamento criado e aguardando confirmação.'}});
  }

  // Desbloqueio dos painéis: Discord autorizado + senha adicional.
  if(req.method==='POST'&&(pathname==='/api/panel/admin/unlock'||pathname==='/api/panel/bot/unlock')){
    const u=requireUser(req,res);if(!u)return;const panel=pathname.includes('/admin/')?'admin':'bot',db=loadDB(),access=accessFor(db,u.discordId);if(panel==='admin'&&!access.admin)return json(res,403,{ok:false,message:'Seu Discord não possui acesso ao Painel Administrativo.'});if(panel==='bot'&&!access.bot)return json(res,403,{ok:false,message:'Seu Discord não possui acesso ao Painel do Bot.'});const b=await body(req),expected=panel==='admin'?ADMIN_PANEL_PASSWORD:BOT_PANEL_PASSWORD;if(!secureEqual(String(b.password||''),expected))return json(res,401,{ok:false,message:'Senha adicional incorreta.'});audit(db,u.discordId,`${panel}_panel_login`);saveDB(db);return json(res,200,{ok:true,token:sign({typ:'panel',panel,discordId:u.discordId,exp:Date.now()+4*60*60*1000}),access});
  }

  // Painel administrativo: acessos, loja, pedidos e licenças.
  if(pathname.startsWith('/api/admin/')){
    const p=requirePanel(req,res,'admin');if(!p)return;
    if(req.method==='GET'&&pathname==='/api/admin/dashboard'){const db=loadDB();return json(res,200,{products:db.products,coupons:db.coupons,orders:db.orders,stats:statsFor(db)});}
    if(req.method==='GET'&&pathname==='/api/admin/access'){const db=loadDB();return json(res,200,{ok:true,ownerDiscordId:OWNER_DISCORD_ID,users:db.authorizedUsers});}
    if(req.method==='POST'&&pathname==='/api/admin/access'){const b=await body(req),id=cleanId(b.discordId);if(id.length<17)return json(res,400,{ok:false,message:'Discord ID inválido.'});const db=loadDB();if(id===OWNER_DISCORD_ID)return json(res,400,{ok:false,message:'O proprietário já possui acesso total permanente.'});let x=db.authorizedUsers.find(v=>v.discordId===id);if(!x){x={discordId:id,label:safeText(b.label,80),admin:!!b.admin,bot:!!b.bot,role:safeText(b.role||'admin',30),addedAt:nowIso(),addedBy:p.discordId};db.authorizedUsers.push(x);}else{x.label=b.label!==undefined?safeText(b.label,80):x.label;x.admin=!!b.admin;x.bot=!!b.bot;x.role=safeText(b.role||x.role,30);x.updatedAt=nowIso();}audit(db,p.discordId,'access_updated',{target:id,admin:x.admin,bot:x.bot});saveDB(db);return json(res,200,{ok:true,user:x});}
    const accessDel=pathname.match(/^\/api\/admin\/access\/(\d{17,24})$/);if(accessDel&&req.method==='DELETE'){if(accessDel[1]===OWNER_DISCORD_ID)return json(res,403,{ok:false,message:'O proprietário possui acesso total permanente e não pode ser removido.'});const db=loadDB();db.authorizedUsers=db.authorizedUsers.filter(x=>x.discordId!==accessDel[1]);audit(db,p.discordId,'access_removed',{target:accessDel[1]});saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='GET'&&pathname==='/api/admin/audit'){const db=loadDB();return json(res,200,{ok:true,logs:db.auditLogs.slice(0,300)});}
    if(req.method==='POST'&&pathname==='/api/admin/upload-image'){const b=await body(req),m=String(b.data||'').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);if(!m)return json(res,400,{ok:false,message:'Imagem inválida.'});const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[m[1]],buf=Buffer.from(m[2],'base64');if(buf.length>5*1024*1024)return json(res,413,{ok:false,message:'Imagem maior que 5 MB.'});const dir=path.join(PUBLIC,'uploads');fs.mkdirSync(dir,{recursive:true});const name=`product-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;fs.writeFileSync(path.join(dir,name),buf);return json(res,201,{ok:true,path:`/uploads/${name}`});}
    if(req.method==='GET'&&pathname==='/api/admin/licenses-diagnostic'){try{return json(res,200,{ok:true,upstream:await licenseApi('/v2/admin/site-bridge-health')});}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    if(req.method==='GET'&&pathname==='/api/admin/licenses'){try{return json(res,200,await licenseApi('/v2/admin/licenses'));}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    if(req.method==='POST'&&pathname==='/api/admin/licenses'){const b=await body(req);try{return json(res,201,await licenseApi('/v2/admin/licenses',{method:'POST',body:JSON.stringify(b)}));}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    const lm=pathname.match(/^\/api\/admin\/licenses\/([^/]+)$/);if(lm&&req.method==='PATCH'){const b=await body(req);try{return json(res,200,await licenseApi('/v2/admin/licenses/'+encodeURIComponent(decodeURIComponent(lm[1])),{method:'PATCH',body:JSON.stringify(b)}));}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    const lr=pathname.match(/^\/api\/admin\/licenses\/([^/]+)\/rotate$/);if(lr&&req.method==='POST'){try{return json(res,200,await licenseApi('/v2/admin/licenses/'+encodeURIComponent(decodeURIComponent(lr[1]))+'/rotate',{method:'POST',body:'{}'}));}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    const lc=pathname.match(/^\/api\/admin\/licenses\/([^/]+)\/clear-binding$/);if(lc&&req.method==='POST'){try{return json(res,200,await licenseApi('/v2/admin/licenses/'+encodeURIComponent(decodeURIComponent(lc[1]))+'/clear-binding',{method:'POST',body:'{}'}));}catch(e){return json(res,e.status||502,{ok:false,message:e.message});}}
    if(req.method==='POST'&&pathname==='/api/admin/products'){const b=await body(req),db=loadDB(),name=safeText(b.name,120),price=Number(b.price),allowed=['VIPs','Carros','Gemas','Outros'],category=allowed.includes(b.category)?b.category:'Outros';if(name.length<2)return json(res,400,{ok:false,message:'Informe o nome do produto.'});if(!Number.isFinite(price)||price<0)return json(res,400,{ok:false,message:'Preço inválido.'});const customId=b.productType==='custom_id',exclusive=customId?false:toBool(b.exclusive),limited=customId?false:toBool(b.limited);let stock=0;if(limited){if(!Number.isFinite(Number(b.stock))||Number(b.stock)<0)return json(res,400,{ok:false,message:'Informe a quantidade do produto limitado.'});stock=Math.floor(Number(b.stock));}let base=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'produto',id=base,n=2;while(db.products.some(q=>q.id===id))id=`${base}-${n++}`;db.products.unshift({id,name,price:+price.toFixed(2),costPrice:+Math.max(0,Number(b.costPrice)||0).toFixed(2),category,badge:safeText(b.badge,80),icon:safeText(b.icon||'◆',12)||'◆',description:safeText(b.description,1200),active:b.active!==false,exclusive,bonus:safeText(b.bonus,500),limited,stock,image:safeText(b.image,500),productType:customId?'custom_id':'normal'});audit(db,p.discordId,'product_created',{id,name});saveDB(db);return json(res,201,{ok:true,id});}
    const pm=pathname.match(/^\/api\/admin\/products\/([^/]+)$/);if(pm&&req.method==='PUT'){const b=await body(req),db=loadDB(),prod=db.products.find(x=>x.id===decodeURIComponent(pm[1]));if(!prod)return json(res,404,{ok:false,message:'Produto não encontrado.'});for(const k of ['name','badge','description','bonus','image'])if(b[k]!==undefined)prod[k]=safeText(b[k],k==='description'?1200:500);if(b.price!==undefined){const price=Number(b.price);if(!Number.isFinite(price)||price<0)return json(res,400,{ok:false,message:'Preço inválido.'});prod.price=+price.toFixed(2);}if(b.costPrice!==undefined)prod.costPrice=+Math.max(0,Number(b.costPrice)||0).toFixed(2);if(b.category!==undefined)prod.category=['VIPs','Carros','Gemas','Outros'].includes(b.category)?b.category:'Outros';if(b.icon!==undefined)prod.icon=safeText(b.icon||'◆',12)||'◆';if(b.active!==undefined)prod.active=!!b.active;if(b.productType!==undefined)prod.productType=b.productType==='custom_id'?'custom_id':'normal';if(b.exclusive!==undefined)prod.exclusive=toBool(b.exclusive);if(b.limited!==undefined)prod.limited=toBool(b.limited);if(isCustomIdProduct(prod)){prod.productType='custom_id';prod.exclusive=false;prod.limited=false;prod.stock=0;}else if(prod.limited){if(b.stock!==undefined){if(!Number.isFinite(Number(b.stock))||Number(b.stock)<0)return json(res,400,{ok:false,message:'Quantidade inválida.'});prod.stock=Math.floor(Number(b.stock));}}else prod.stock=0;audit(db,p.discordId,'product_updated',{id:prod.id});saveDB(db);return json(res,200,{ok:true});}
    if(pm&&req.method==='DELETE'){const db=loadDB(),before=db.products.length;db.products=db.products.filter(x=>x.id!==decodeURIComponent(pm[1]));if(before===db.products.length)return json(res,404,{ok:false});audit(db,p.discordId,'product_deleted',{id:decodeURIComponent(pm[1])});saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='POST'&&pathname==='/api/admin/coupons'){const b=await body(req),db=loadDB(),code=safeText(b.code,40).toUpperCase().replace(/[^A-Z0-9_-]/g,''),discount=Math.max(1,Math.min(100,Number(b.discount)||0));if(code.length<3)return json(res,400,{ok:false,message:'Use um código com pelo menos 3 caracteres.'});if(db.coupons.some(c=>c.code===code))return json(res,409,{ok:false,message:'Esse cupom já existe.'});db.coupons.unshift({code,discount,active:b.active!==false,maxUses:Math.max(0,Number(b.maxUses)||0),uses:0,expiresAt:b.expiresAt||''});audit(db,p.discordId,'coupon_created',{code});saveDB(db);return json(res,201,{ok:true});}
    const cm=pathname.match(/^\/api\/admin\/coupons\/([^/]+)$/);if(cm&&req.method==='PUT'){const b=await body(req),db=loadDB(),c=db.coupons.find(x=>x.code===decodeURIComponent(cm[1]).toUpperCase());if(!c)return json(res,404,{ok:false});c.discount=Math.max(1,Math.min(100,Number(b.discount)||c.discount));c.active=!!b.active;c.maxUses=Math.max(0,Number(b.maxUses)||0);c.expiresAt=b.expiresAt||'';saveDB(db);return json(res,200,{ok:true});}if(cm&&req.method==='DELETE'){const db=loadDB();db.coupons=db.coupons.filter(x=>x.code!==decodeURIComponent(cm[1]).toUpperCase());saveDB(db);return json(res,200,{ok:true});}
    return json(res,404,{ok:false,message:'Rota administrativa não encontrada.'});
  }

  // Painel do Bot: configurações completas e fila de ações.
  if(pathname.startsWith('/api/bot-panel/')){
    const p=requirePanel(req,res,'bot');if(!p)return;
    if(req.method==='GET'&&pathname==='/api/bot-panel/config'){const db=loadDB();return json(res,200,{ok:true,revision:db.botControl.revision,settings:db.botControl.settings,legacySettings:db.botControl.legacySettings||{},serverStatus:db.serverStatus});}
    if(req.method==='PUT'&&pathname==='/api/bot-panel/config'){const b=await body(req),db=loadDB();if(b.settings&&typeof b.settings==='object')db.botControl.settings={...db.botControl.settings,...b.settings};if(b.legacySettings&&typeof b.legacySettings==='object')db.botControl.legacySettings=b.legacySettings;db.botControl.revision++;audit(db,p.discordId,'bot_config_updated',{revision:db.botControl.revision});saveDB(db);return json(res,200,{ok:true,revision:db.botControl.revision});}
    if(req.method==='POST'&&pathname==='/api/bot-panel/actions'){const b=await body(req),allowed=['publish_status','publish_allowlist','refresh_status'];if(!allowed.includes(b.type))return json(res,400,{ok:false,message:'Ação inválida.'});const db=loadDB(),action={id:randomId(10),type:b.type,channelId:cleanId(b.channelId),createdAt:nowIso(),createdBy:p.discordId,ackedAt:null};db.botControl.actions.push(action);audit(db,p.discordId,'bot_action_created',{type:b.type});saveDB(db);return json(res,201,{ok:true,action});}
    if(req.method==='GET'&&pathname==='/api/bot-panel/allowlist/attempts'){const db=loadDB();return json(res,200,{ok:true,attempts:db.allowlist.attempts.slice().reverse().slice(0,200),bindings:db.allowlist.bindings.slice().reverse().slice(0,200)});}
    return json(res,404,{ok:false,message:'Rota do Painel do Bot não encontrada.'});
  }

  // Bot API - somente com chave secreta do bot.
  if(pathname.startsWith('/api/bot/')){
    if(!isStoreBot(req))return json(res,401,{ok:false,message:'Chave do bot inválida.'});
    if(req.method==='GET'&&pathname==='/api/bot/config'){const db=loadDB();return json(res,200,{ok:true,revision:db.botControl.revision,settings:db.botControl.settings,legacySettings:db.botControl.legacySettings||{},serverStatus:db.serverStatus});}
    if(req.method==='POST'&&pathname==='/api/bot/legacy-settings'){const b=await body(req),db=loadDB();if(!b.settings||typeof b.settings!=='object')return json(res,400,{ok:false,message:'settings inválido.'});db.botControl.legacySettings=b.settings;db.botControl.revision++;saveDB(db);return json(res,200,{ok:true,revision:db.botControl.revision});}
    if(req.method==='POST'&&pathname==='/api/bot/config/patch'){const b=await body(req),db=loadDB();if(!b.settings||typeof b.settings!=='object')return json(res,400,{ok:false,message:'settings inválido.'});db.botControl.settings={...db.botControl.settings,...b.settings};db.botControl.revision++;saveDB(db);return json(res,200,{ok:true,revision:db.botControl.revision});}
    if(req.method==='POST'&&pathname==='/api/bot/config/runtime'){const b=await body(req),db=loadDB();if(b.legacySettings&&typeof b.legacySettings==='object')db.botControl.legacySettings=b.legacySettings;if(b.serverStatusMessageId!==undefined)db.botControl.settings.serverStatus.messageId=safeText(b.serverStatusMessageId,30);if(b.whitelistPanelMessageId!==undefined)db.botControl.settings.allowlist.panelMessageId=safeText(b.whitelistPanelMessageId,30);if(b.whitelistPanelChannelId!==undefined)db.botControl.settings.allowlist.panelChannelId=safeText(b.whitelistPanelChannelId,30);db.botControl.revision++;saveDB(db);return json(res,200,{ok:true,revision:db.botControl.revision});}
    if(req.method==='GET'&&pathname==='/api/bot/actions/pending'){const db=loadDB();return json(res,200,{ok:true,actions:db.botControl.actions.filter(x=>!x.ackedAt).slice(0,20)});}
    const actionAck=pathname.match(/^\/api\/bot\/actions\/([^/]+)\/ack$/);if(actionAck&&req.method==='POST'){const b=await body(req),db=loadDB(),a=db.botControl.actions.find(x=>x.id===actionAck[1]);if(!a)return json(res,404,{ok:false});a.ackedAt=nowIso();a.result=b.result||null;if(b.patch&&typeof b.patch==='object'){db.botControl.settings={...db.botControl.settings,...b.patch};db.botControl.revision++;}saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='GET'&&pathname==='/api/bot/orders/logs/pending'){const db=loadDB(),orders=db.orders.filter(o=>isPaidStatus(o.paymentStatus)&&!o.discordPurchaseLoggedAt).slice(0,30).map(o=>({id:o.id,account:o.account,gameId:o.gameId??null,discordId:o.discordId||'',discordDisplayName:o.discordDisplayName||o.discordUsername||'',items:o.items,total:o.total,discount:o.discount,paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,createdAt:o.createdAt,desiredId:o.desiredId??null}));return json(res,200,{ok:true,orders});}
    const purchaseAck=pathname.match(/^\/api\/bot\/orders\/([^/]+)\/logged$/);if(purchaseAck&&req.method==='POST'){const db=loadDB(),o=db.orders.find(x=>x.id===decodeURIComponent(purchaseAck[1]));if(!o)return json(res,404,{ok:false});o.discordPurchaseLoggedAt=nowIso();saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='GET'&&pathname==='/api/bot/id-orders/logs/pending'){const db=loadDB(),orders=db.orders.filter(o=>o.desiredId!==null&&o.desiredId!==undefined&&o.idDeliveryStatus==='delivered'&&!o.idDiscordLoggedAt).slice(0,20).map(o=>({id:o.id,account:o.account,oldId:o.idOldId??null,desiredId:Number(o.desiredId),total:o.total,paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,discord:o.discord||'',discordId:o.discordId||'',createdAt:o.createdAt,deliveredAt:o.deliveredAt||o.idUpdatedAt||null,message:o.idDeliveryMessage||''}));return json(res,200,{ok:true,orders});}
    const botAck=pathname.match(/^\/api\/bot\/id-orders\/([^/]+)\/logged$/);if(botAck&&req.method==='POST'){const db=loadDB(),o=db.orders.find(x=>x.id===decodeURIComponent(botAck[1]));if(!o)return json(res,404,{ok:false});o.idDiscordLoggedAt=nowIso();saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='POST'&&pathname==='/api/bot/whitelist/code/claim'){
      const b=await body(req),code=safeText(b.code,30).toUpperCase(),discordId=cleanId(b.discordId),db=loadDB(),cfg=db.botControl.settings.allowlist;
      if(!cfg.enabled)return json(res,409,{ok:false,message:'A whitelist está desativada no momento.'});
      const c=db.allowlist.codes.find(x=>x.code===code&&!x.usedAt&&!x.invalidatedAt&&x.expiresAt>Date.now());
      if(!c)return json(res,400,{ok:false,message:'Código inválido ou expirado. Entre no servidor novamente para gerar outro.'});
      const already=db.allowlist.bindings.find(x=>x.discordId===discordId&&x.status==='approved');if(already)return json(res,409,{ok:false,message:'Seu Discord já possui whitelist aprovada.'});
      c.discordId=discordId;c.claimedAt=nowIso();
      const attempt={id:randomId(12),code,serial:c.serial,discordId,discordUsername:safeText(b.discordUsername,64),discordDisplayName:safeText(b.discordDisplayName,64),status:'in_progress',score:0,currentIndex:0,answers:[],createdAt:nowIso(),finishedAt:null};db.allowlist.attempts.push(attempt);saveDB(db);
      const total=Math.min(Math.max(1,Number(cfg.questionCount||10)),10,(cfg.questions||[]).length);
      return json(res,200,{ok:true,attemptId:attempt.id,gameLogin:null,gameId:null,config:{questions:(cfg.questions||[]).slice(0,total).map(q=>({question:q.question,options:q.options})),minScore:Number(cfg.minScore||8),closeSeconds:Number(cfg.closeSeconds||5),approvalMode:cfg.approvalMode||'auto'}});
    }
    const wlFinish=pathname.match(/^\/api\/bot\/whitelist\/attempts\/([^/]+)\/finish$/);
    if(wlFinish&&req.method==='POST'){
      const b=await body(req),db=loadDB(),a=db.allowlist.attempts.find(x=>x.id===wlFinish[1]),cfg=db.botControl.settings.allowlist;if(!a)return json(res,404,{ok:false,message:'Tentativa não encontrada.'});if(a.status!=='in_progress')return json(res,409,{ok:false,message:'Tentativa já finalizada.',status:a.status});
      const answers=Array.isArray(b.answers)?b.answers:[],total=Math.min(Math.max(1,Number(cfg.questionCount||10)),10,(cfg.questions||[]).length);let score=0;for(let i=0;i<total;i++){const q=cfg.questions[i];if(Number(answers[i])===Number(q?.correctIndex))score++;}
      a.answers=answers.slice(0,total);a.score=score;a.finishedAt=nowIso();const passed=score>=Number(cfg.minScore||8);if(!passed)a.status='rejected';else if(cfg.approvalMode==='staff')a.status='pending_staff';else{a.status='approved';upsertApprovedBinding(db,{serial:a.serial,discordId:a.discordId,attemptId:a.id});}const c=db.allowlist.codes.find(x=>x.code===a.code);if(c)c.usedAt=nowIso();const binding=db.allowlist.bindings.find(x=>x.discordId===a.discordId&&x.status==='approved');saveDB(db);return json(res,200,{ok:true,passed,status:a.status,score,total,minScore:Number(cfg.minScore||8),discordId:a.discordId,gameLogin:binding?.gameLogin||null,gameId:binding?.gameId??null});
    }
    const wlDecision=pathname.match(/^\/api\/bot\/whitelist\/attempts\/([^/]+)\/decision$/);
    if(wlDecision&&req.method==='POST'){
      const b=await body(req),db=loadDB(),a=db.allowlist.attempts.find(x=>x.id===wlDecision[1]);if(!a)return json(res,404,{ok:false,message:'Tentativa não encontrada.'});if(a.status!=='pending_staff')return json(res,409,{ok:false,message:'Esta tentativa não aguarda análise da staff.'});a.staffDiscordId=cleanId(b.staffDiscordId);a.staffDecisionAt=nowIso();if(b.approved){a.status='approved';upsertApprovedBinding(db,{serial:a.serial,discordId:a.discordId,attemptId:a.id});}else a.status='staff_rejected';const binding=db.allowlist.bindings.find(x=>x.discordId===a.discordId&&x.status==='approved');saveDB(db);return json(res,200,{ok:true,status:a.status,discordId:a.discordId,gameLogin:binding?.gameLogin||null,gameId:binding?.gameId??null});
    }
    if(req.method==='POST'&&pathname==='/api/bot/allowlist/claim'){const b=await body(req),code=safeText(b.code,30).toUpperCase(),discordId=cleanId(b.discordId),db=loadDB(),cfg=db.botControl.settings.allowlist;if(!cfg.enabled)return json(res,409,{ok:false,message:'A Allowlist está desativada no momento.'});const c=db.allowlist.codes.find(x=>x.code===code&&!x.usedAt&&!x.invalidatedAt&&x.expiresAt>Date.now());if(!c)return json(res,400,{ok:false,message:'Código inválido ou expirado. Entre no servidor novamente para gerar outro.'});const already=db.allowlist.bindings.find(x=>x.discordId===discordId&&x.status==='approved');if(already)return json(res,409,{ok:false,message:'Seu Discord já possui Allowlist aprovada.'});c.discordId=discordId;c.claimedAt=nowIso();const attempt={id:randomId(12),code,serial:c.serial,discordId,status:'in_progress',score:0,currentIndex:0,answers:[],createdAt:nowIso(),finishedAt:null};db.allowlist.attempts.push(attempt);saveDB(db);return json(res,200,{ok:true,attemptId:attempt.id,question:publicQuestion(cfg,0),closeSeconds:Number(cfg.closeSeconds||5)});}
    const questionGet=pathname.match(/^\/api\/bot\/allowlist\/attempt\/([^/]+)\/question$/);if(questionGet&&req.method==='GET'){const db=loadDB(),a=db.allowlist.attempts.find(x=>x.id===questionGet[1]);if(!a)return json(res,404,{ok:false});if(a.status!=='in_progress')return json(res,409,{ok:false,status:a.status,message:'Tentativa já finalizada.'});return json(res,200,{ok:true,question:publicQuestion(db.botControl.settings.allowlist,a.currentIndex)});}
    const answerPost=pathname.match(/^\/api\/bot\/allowlist\/attempt\/([^/]+)\/answer$/);if(answerPost&&req.method==='POST'){const b=await body(req),db=loadDB(),a=db.allowlist.attempts.find(x=>x.id===answerPost[1]),cfg=db.botControl.settings.allowlist;if(!a)return json(res,404,{ok:false});if(a.status!=='in_progress')return json(res,409,{ok:false,status:a.status,message:'Tentativa já finalizada.'});if(cleanId(b.discordId)!==a.discordId)return json(res,403,{ok:false,message:'Esta prova pertence a outro usuário.'});const q=cfg.questions[a.currentIndex],optionIndex=Number(b.optionIndex);if(!q||!Number.isInteger(optionIndex)||optionIndex<0||optionIndex>=q.options.length)return json(res,400,{ok:false,message:'Resposta inválida.'});const correct=optionIndex===Number(q.correctIndex);a.answers.push({index:a.currentIndex,optionIndex,correct});if(correct)a.score++;a.currentIndex++;const total=Math.min(Number(cfg.questionCount||10),cfg.questions.length);if(a.currentIndex<total){saveDB(db);return json(res,200,{ok:true,finished:false,score:a.score,question:publicQuestion(cfg,a.currentIndex)});}a.finishedAt=nowIso();const passed=a.score>=Number(cfg.minScore||8);if(!passed)a.status='rejected';else if(cfg.approvalMode==='staff')a.status='awaiting_staff';else{a.status='approved';upsertApprovedBinding(db,{serial:a.serial,discordId:a.discordId,attemptId:a.id});}const c=db.allowlist.codes.find(x=>x.code===a.code);if(c)c.usedAt=nowIso();saveDB(db);return json(res,200,{ok:true,finished:true,status:a.status,score:a.score,total,minScore:Number(cfg.minScore||8),passed,approvalMode:cfg.approvalMode,closeSeconds:Number(cfg.closeSeconds||5)});}
    const decision=pathname.match(/^\/api\/bot\/allowlist\/attempt\/([^/]+)\/decision$/);if(decision&&req.method==='POST'){const b=await body(req),db=loadDB(),a=db.allowlist.attempts.find(x=>x.id===decision[1]);if(!a)return json(res,404,{ok:false});if(a.status!=='awaiting_staff')return json(res,409,{ok:false,message:'Esta tentativa não aguarda decisão da staff.'});if(b.approved){a.status='approved';a.staffDecisionAt=nowIso();a.staffDiscordId=cleanId(b.staffDiscordId);upsertApprovedBinding(db,{serial:a.serial,discordId:a.discordId,attemptId:a.id});}else{a.status='staff_rejected';a.staffDecisionAt=nowIso();a.staffDiscordId=cleanId(b.staffDiscordId);}saveDB(db);return json(res,200,{ok:true,status:a.status,score:a.score});}
    return json(res,404,{ok:false,message:'Rota do bot não encontrada.'});
  }

  // MTA Store + Allowlist.
  if(pathname.startsWith('/api/mta/')){
    if(!isMTA(req))return json(res,401,{ok:false,message:'Chave MTA inválida.'});
    if(req.method==='POST'&&pathname==='/api/mta/status-heartbeat'){const b=await body(req),db=loadDB();db.serverStatus={online:true,updatedAt:nowIso(),players:Math.max(0,Number(b.players)||0),maxPlayers:Math.max(0,Number(b.maxPlayers)||0),name:safeText(b.name||'HorizonVille Roleplay',120),ip:safeText(b.ip,80),port:Number(b.port)||null};saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='POST'&&pathname==='/api/mta/allowlist/request'){const b=await body(req),serial=safeText(b.serial,64);if(serial.length<8)return json(res,400,{ok:false,message:'Serial inválido.'});const db=loadDB(),binding=approvedBindingBySerial(db,serial);if(binding)return json(res,200,{ok:true,approved:true,discordId:binding.discordId});const c=createAllowlistCode(db,serial,b.nickname);saveDB(db);return json(res,200,{ok:true,approved:false,code:c.code,expiresAt:c.expiresAt,discordInvite:DISCORD_INVITE_URL});}
    if(req.method==='POST'&&pathname==='/api/mta/allowlist/check'){const b=await body(req),db=loadDB(),binding=approvedBindingBySerial(db,safeText(b.serial,64));return json(res,200,{ok:true,approved:!!binding});}
    if(req.method==='POST'&&pathname==='/api/mta/allowlist/link-account'){const b=await body(req),serial=safeText(b.serial,64),login=safeText(b.login,64),gameId=Number(b.gameId),db=loadDB(),binding=approvedBindingBySerial(db,serial);if(!binding)return json(res,403,{ok:false,message:'Serial ainda não possui Allowlist aprovada.'});if(!login||!Number.isInteger(gameId)||gameId<1)return json(res,400,{ok:false,message:'Conta/ID inválidos.'});const conflict=db.allowlist.bindings.find(x=>x.id!==binding.id&&x.status==='approved'&&(String(x.gameLogin||'').toLowerCase()===login.toLowerCase()||Number(x.gameId)===gameId));if(conflict)return json(res,409,{ok:false,message:'Esta conta/ID já está vinculada a outro Discord.'});binding.gameLogin=login;binding.gameId=gameId;binding.linkedAt=nowIso();saveDB(db);return json(res,200,{ok:true,discordId:binding.discordId});}
    if(req.method==='GET'&&pathname==='/api/mta/pending'){const db=loadDB();return json(res,200,{orders:db.orders.filter(o=>isPaidStatus(o.paymentStatus)&&o.deliveryStatus==='pending'&&!o.items?.some(i=>isCustomIdProduct(i))).slice(0,50)});}
    const dm=pathname.match(/^\/api\/mta\/orders\/([^/]+)\/delivered$/);if(dm&&req.method==='POST'){const db=loadDB(),o=db.orders.find(x=>x.id===dm[1]);if(!o)return json(res,404,{ok:false});o.deliveryStatus='delivered';o.deliveredAt=nowIso();saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='GET'&&pathname==='/api/mta/id-checks/pending'){const db=loadDB(),now=Date.now(),checks=db.idChecks.filter(x=>x.status==='pending'&&now-new Date(x.createdAt).getTime()<ID_CHECK_PENDING_TTL_MS).slice(0,30).map(x=>({token:x.token,account:x.account,desiredId:Number(x.desiredId)}));return json(res,200,{ok:true,checks});}
    const idCheckMta=pathname.match(/^\/api\/mta\/id-checks\/([a-f0-9]{36})\/result$/);if(idCheckMta&&req.method==='POST'){const b=await body(req),db=loadDB(),x=db.idChecks.find(v=>v.token===idCheckMta[1]);if(!x)return json(res,404,{ok:false});if(x.status!=='pending')return json(res,200,{ok:true,ignored:true});x.status=b.status==='failed'?'failed':'done';x.accountExists=!!b.accountExists;x.available=b.available===true;x.oldId=b.oldId==null?null:Number(b.oldId);x.message=safeText(b.message,300);x.updatedAt=nowIso();saveDB(db);return json(res,200,{ok:true});}
    if(req.method==='GET'&&pathname==='/api/mta/id-orders/pending'){const db=loadDB(),orders=db.orders.filter(o=>isPaidStatus(o.paymentStatus)&&o.idDeliveryStatus==='pending'&&Number.isInteger(Number(o.desiredId))).slice(0,20).map(o=>({id:o.id,account:o.account,desiredId:Number(o.desiredId),createdAt:o.createdAt}));return json(res,200,{ok:true,orders});}
    const idm=pathname.match(/^\/api\/mta\/id-orders\/([^/]+)\/status$/);if(idm&&req.method==='POST'){const b=await body(req),db=loadDB(),o=db.orders.find(x=>x.id===idm[1]);if(!o)return json(res,404,{ok:false});const allowed=['pending','processing','delivered','blocked','failed'],status=allowed.includes(String(b.status))?String(b.status):'failed';o.idDeliveryStatus=status;o.idDeliveryMessage=safeText(b.message,500);o.idOldId=b.oldId==null?o.idOldId:Number(b.oldId);o.idUpdatedAt=nowIso();if(status==='delivered'){o.deliveryStatus='delivered';o.deliveredAt=nowIso();}saveDB(db);return json(res,200,{ok:true});}
    return json(res,404,{ok:false,message:'Rota MTA não encontrada.'});
  }

  return false;
}

function serve(req,res,url){
  const aliases={'/loja':'/store.html','/carrinho':'/cart.html','/perfil':'/profile.html','/minhas-compras':'/orders.html','/hv-admin':'/hv-admin.html','/hv-bot-panel':'/hv-bot-panel.html'};
  let pathname=url.pathname==='/'?'/index.html':(aliases[url.pathname]||url.pathname);pathname=decodeURIComponent(pathname);
  const file=path.normalize(path.join(PUBLIC,pathname));if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Página não encontrada');}const headers={'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream'};if(['/hv-admin.html','/hv-bot-panel.html','/profile.html','/orders.html','/auth.html'].includes(pathname))headers['X-Robots-Tag']='noindex, nofollow, noarchive';res.writeHead(200,headers);fs.createReadStream(file).pipe(res);});
}

http.createServer(async(req,res)=>{try{addCors(req,res);if(req.method==='OPTIONS'){res.writeHead(204,{'Cache-Control':'no-store'});return res.end();}const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/')){const done=await api(req,res,url);if(done===false)json(res,404,{ok:false,message:'Rota não encontrada.'});return;}serve(req,res,url);}catch(e){console.error(e);if(e instanceof SyntaxError)return json(res,400,{ok:false,message:'JSON inválido na requisição.'});json(res,500,{ok:false,message:e.message==='Corpo muito grande.'?e.message:'Erro interno.'});}}).listen(PORT,()=>console.log(`HorizonVille v7-discord-control online na porta ${PORT}`));
