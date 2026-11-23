// BUTTON BUILDER PRO — GALAXY VIP V6 MAX
// Single-file Cloudflare Worker for Telegram Bot API.
// Required bindings: BOT_TOKEN (Secret), ADMIN_ID (Variable), BB_KV (KV Namespace)
// Optional vars: BOT_USERNAME, REQUIRED_CHANNELS, CHANNEL_LINKS, AUTO_FORWARD_SOURCES
// Configure a Cron Trigger: * * * * *  (one-minute schedule runner)
// Set Telegram webhook to: https://YOUR-WORKER.workers.dev/?secret=YOUR_WEBHOOK_SECRET
// If WEBHOOK_SECRET is configured, set it as a Secret and use the same value in the webhook URL.

const API = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(r => r.json());

const get = async (env, k, fallback = null) => {
  const v = await env.BB_KV.get(k);
  if (v === null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
const put = (env, k, v) => env.BB_KV.put(k, JSON.stringify(v));
const del = (env, k) => env.BB_KV.delete(k);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s || "").replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
const isOwner = (env, id) => String(id) === String(env.ADMIN_ID);
const channels = env => (env.REQUIRED_CHANNELS || "").split(",").map(x => x.trim()).filter(Boolean);
const links = env => (env.CHANNEL_LINKS || "").split(",").map(x => x.trim()).filter(Boolean);
const home = (lang="en") => ({ inline_keyboard: [
  [{text:"📝 Create Post",callback_data:"new"},{text:"📂 My Drafts",callback_data:"drafts"}],
  [{text:"📢 Publish",callback_data:"publish_help"},{text:"⏰ Schedule",callback_data:"schedule_help"}],
  [{text:"🔘 Button Builder",callback_data:"builder_help"},{text:"📡 Channels",callback_data:"channels"}],
  [{text:"🎁 Referral",callback_data:"referral"},{text:"🎫 Support Ticket",callback_data:"ticket"}],
  [{text:"📊 Analytics",callback_data:"analytics"},{text:"🌐 Language",callback_data:"language"}],
  [{text:"💾 Backup",callback_data:"backup"},{text:"ℹ️ Help",callback_data:"help"}]
]});
async function send(env, chat, text, extra={}) {
  return API(env,"sendMessage",{chat_id:chat,text,parse_mode:"HTML",...extra});
}
async function answer(env, id, text="") { return API(env,"answerCallbackQuery",{callback_query_id:id,text}); }
async function edit(env, chat, mid, text, extra={}) {
  return API(env,"editMessageText",{chat_id:chat,message_id:mid,text,parse_mode:"HTML",...extra});
}
async function memberOK(env, userId) {
  if (isOwner(env,userId)) return true;
  for (const ch of channels(env)) {
    const r = await API(env,"getChatMember",{chat_id:ch,user_id:userId});
    const s = r?.result?.status;
    if (!r.ok || !["member","administrator","creator"].includes(s)) return false;
  }
  return true;
}
async function joinGate(env, chat, userId) {
  const req = channels(env);
  if (!req.length || await memberOK(env,userId)) return true;
  const ls = links(env);
  const rows = req.map((c,i)=>[{text:`Join ${c}`,url:ls[i] || (c.startsWith("@") ? `https://t.me/${c.slice(1)}` : "https://t.me/")}]);
  rows.push([{text:"✅ I Joined — Check",callback_data:"checkjoin"}]);
  await send(env,chat,"🔒 <b>Channel verification required</b>\n\nPlease join all required channels, then press CHECK JOIN.",{reply_markup:{inline_keyboard:rows}});
  return false;
}
async function userData(env,id) {
  return await get(env,`u:${id}`,{lang:"en",joined:Date.now(),ref:null,posts:0});
}
async function setUser(env,id,obj) { await put(env,`u:${id}`,obj); }
async function draft(env,id) { return await get(env,`draft:${id}`,null); }
async function setDraft(env,id,d) { await put(env,`draft:${id}`,d); }
async function adminAllowed(env,id,perm) {
  if (isOwner(env,id)) return true;
  const a = await get(env,`admin:${id}`,null);
  return !!a && (a.permissions || []).includes(perm);
}
async function allDestinations(env) { return await get(env,"destinations",[]); }
async function sendPost(env, destination, post) {
  let result;
  if (post.file_id) {
    const method = post.kind === "photo" ? "sendPhoto" : post.kind === "video" ? "sendVideo" :
      post.kind === "document" ? "sendDocument" : post.kind === "animation" ? "sendAnimation" :
      post.kind === "audio" ? "sendAudio" : "sendVoice";
    result = await API(env,method,{chat_id:destination,[post.kind==="photo"?"photo":post.kind==="video"?"video":post.kind==="document"?"document":post.kind==="animation"?"animation":post.kind==="audio"?"audio":"voice"]:post.file_id,caption:post.caption || "",parse_mode:"HTML",reply_markup:post.buttons?.length?{inline_keyboard:post.buttons}:undefined});
  } else {
    result = await API(env,"sendMessage",{chat_id:destination,text:post.text || " ",parse_mode:"HTML",reply_markup:post.buttons?.length?{inline_keyboard:post.buttons}:undefined,disable_web_page_preview:false});
  }
  return result;
}
async function publish(env, post) {
  const ds = await allDestinations(env);
  if (!ds.length) return {ok:false,description:"No destination channels. Add one with /addchannel @channel"};
  const results = [];
  for (const d of ds) results.push(await sendPost(env,d,post));
  return {ok:results.some(x=>x.ok),results};
}
async function showMenu(env,chat,id) {
  const u = await userData(env,id);
  await send(env,chat,`<b>BUTTON BUILDER PRO — GALAXY VIP V6 MAX</b>\n\nWelcome! Choose an option below.\nLanguage: ${u.lang || "en"}`,{reply_markup:home(u.lang)});
}
async function makeBackup(env,chat) {
  const keys = await env.BB_KV.list({limit:1000});
  const data = {};
  for (const k of keys.keys) data[k.name] = await env.BB_KV.get(k.name);
  const blob = JSON.stringify({created_at:new Date().toISOString(),data});
  if (blob.length > 45000) {
    await send(env,chat,"Backup is too large for a Telegram message. Use Cloudflare KV export for a full large backup.");
    return;
  }
  // Send compact backup text; for large exports use Cloudflare KV export.
  await send(env,chat,"<b>Backup JSON</b>\n<code>"+esc(blob)+"</code>");
}
async function processMessage(env,m) {
  const chat=m.chat.id, id=m.from?.id;
  if (!id) return;
  if (!await joinGate(env,chat,id)) return;
  const text=m.text || m.caption || "";
  let u=await userData(env,id);
  const state=await get(env,`state:${id}`,null);
  if (state==="draft_content") {
    const p={id:uid(),created:Date.now(),buttons:[],text:text,file_id:null,kind:null,caption:m.caption||""};
    if (m.photo?.length) {p.file_id=m.photo[m.photo.length-1].file_id;p.kind="photo";p.text="";}
    else if (m.video) {p.file_id=m.video.file_id;p.kind="video";p.text="";}
    else if (m.document) {p.file_id=m.document.file_id;p.kind="document";p.text="";}
    else if (m.animation) {p.file_id=m.animation.file_id;p.kind="animation";p.text="";}
    else if (m.audio) {p.file_id=m.audio.file_id;p.kind="audio";p.text="";}
    else if (m.voice) {p.file_id=m.voice.file_id;p.kind="voice";p.text="";}
    await setDraft(env,id,p); await del(env,`state:${id}`);
    await send(env,chat,"✅ Draft saved. Add URL buttons with:\n/addbutton Button Name | https://example.com\n\nThen use /preview or /publish.");
    return;
  }
  if (text.startsWith("/start")) {
    const ref=text.split(" ")[1];
    if (ref && ref!==String(id)) {
      const old=await userData(env,id);
      if (!old.ref) {old.ref=ref;await setUser(env,id,old);const r=await get(env,`refcount:${ref}`,0);await put(env,`refcount:${ref}`,r+1);}
    }
    await showMenu(env,chat,id); return;
  }
  if (text==="/menu") return showMenu(env,chat,id);
  if (text==="/help") {await send(env,chat,"<b>Commands</b>\n/new — create post\n/addbutton Label | URL — add button\n/preview — preview draft\n/publish — publish draft\n/schedule YYYY-MM-DD HH:MM — one-time schedule (UTC)\n/repeat daily HH:MM — daily schedule (UTC)\n/repeat weekly DAY HH:MM — weekly schedule (UTC)\n/addchannel @channel — add destination\n/channels — list destinations\n/removechannel @channel — remove destination\n/referral — referral link\n/ticket your message — open ticket\n/backup — backup\n");return;}
  if (text==="/new") {await put(env,`state:${id}`,"draft_content");await send(env,chat,"Send the post text, photo, video, document, audio, voice or animation now.");return;}
  if (text.startsWith("/addbutton ")) {
    const d=await draft(env,id); if(!d){await send(env,chat,"Create a draft first with /new.");return;}
    const v=text.slice(11).split("|");const label=(v[0]||"").trim(),url=(v[1]||"").trim();
    if(!label||!/^https?:\/\//i.test(url)){await send(env,chat,"Format: /addbutton Label | https://example.com");return;}
    d.buttons.push([{text:label,url}]);await setDraft(env,id,d);await send(env,chat,"Button added.");return;
  }
  if (text==="/preview") {const d=await draft(env,id);if(!d){await send(env,chat,"No draft. Use /new.");return;}await sendPost(env,chat,d);return;}
  if (text==="/publish") {if(!await adminAllowed(env,id,"publish")){await send(env,chat,"Only owner/admin with publish permission can publish.");return;}const d=await draft(env,id);if(!d){await send(env,chat,"No draft. Use /new.");return;}const r=await publish(env,d);await send(env,chat,r.ok?"✅ Published to configured destination(s).":"❌ Publish failed: "+esc(r.description||"check bot admin permissions"));if(r.ok){u.posts=(u.posts||0)+1;await setUser(env,id,u);}return;}
  if (text.startsWith("/addchannel ")) {if(!isOwner(env,id)){await send(env,chat,"Owner only.");return;}const c=text.split(" ")[1];if(!c){await send(env,chat,"Use /addchannel @channel");return;}const ds=await allDestinations(env);if(!ds.includes(c))ds.push(c);await put(env,"destinations",ds);await send(env,chat,"Added destination: "+esc(c));return;}
  if (text==="/channels") {const ds=await allDestinations(env);await send(env,chat,"<b>Destination channels</b>\n"+(ds.length?ds.map(esc).join("\n"):"None yet")+"\n\nAdd: /addchannel @channel");return;}
  if (text.startsWith("/removechannel ")) {if(!isOwner(env,id))return;const c=text.split(" ")[1];await put(env,"destinations",(await allDestinations(env)).filter(x=>x!==c));await send(env,chat,"Removed "+esc(c));return;}
  if (text.startsWith("/schedule ")) {if(!await adminAllowed(env,id,"publish"))return;const d=await draft(env,id);if(!d){await send(env,chat,"Create a draft first.");return;}const when=text.slice(10).trim();const ts=Date.parse(when.replace(" ","T")+"Z");if(!Number.isFinite(ts)||ts<Date.now()){await send(env,chat,"Use /schedule 2026-12-01 14:30 (UTC, future time).");return;}const jobs=await get(env,"jobs",[]);jobs.push({id:uid(),at:ts,post:d,owner:id});await put(env,"jobs",jobs);await send(env,chat,"⏰ One-time post scheduled.");return;}
  if (text.startsWith("/repeat ")) {if(!isOwner(env,id))return;const d=await draft(env,id);if(!d){await send(env,chat,"Create a draft first.");return;}const p=text.split(/\s+/);let job;if(p[1]==="daily"&&/^\d\d:\d\d$/.test(p[2]||""))job={id:uid(),repeat:"daily",time:p[2],post:d,owner:id};else if(p[1]==="weekly"&&/^(mon|tue|wed|thu|fri|sat|sun)$/i.test(p[2]||"")&&/^\d\d:\d\d$/.test(p[3]||""))job={id:uid(),repeat:"weekly",day:p[2].toLowerCase(),time:p[3],post:d,owner:id};else{await send(env,chat,"Use /repeat daily 09:00 OR /repeat weekly mon 09:00 (UTC).");return;}const jobs=await get(env,"jobs",[]);jobs.push(job);await put(env,"jobs",jobs);await send(env,chat,"🔁 Recurring schedule saved (UTC).");return;}
  if (text==="/schedules") {const jobs=await get(env,"jobs",[]);await send(env,chat,"<b>Scheduled jobs</b>\n"+(jobs.length?jobs.map(j=>`${j.id} — ${j.repeat||new Date(j.at).toISOString()}`).join("\n"):"None"));return;}
  if (text.startsWith("/canceljob ")) {if(!isOwner(env,id))return;const x=text.split(" ")[1];await put(env,"jobs",(await get(env,"jobs",[])).filter(j=>j.id!==x));await send(env,chat,"Schedule removed if it existed.");return;}
  if (text==="/referral") {const name=env.BOT_USERNAME||"YOUR_BOT_USERNAME";const n=await get(env,`refcount:${id}`,0);await send(env,chat,`Your referral link:\nhttps://t.me/${name}?start=${id}\nSuccessful starts: ${n}`);return;}
  if (text.startsWith("/ticket")) {const msg=text.replace(/^\/ticket\s*/,"").trim();if(!msg){await send(env,chat,"Use /ticket Your message");return;}const tid=uid();await put(env,`ticket:${tid}`,{id:tid,user:id,chat,message:msg,status:"open",created:Date.now()});const owner=env.ADMIN_ID;await send(env,owner,`🎫 <b>New ticket ${tid}</b>\nUser: <code>${id}</code>\n${esc(msg)}\nReply: /reply ${tid} your answer`);await send(env,chat,"Ticket opened: "+tid);return;}
  if (text.startsWith("/reply ")) {if(!isOwner(env,id))return;const p=text.split(" ");const tid=p[1],msg=p.slice(2).join(" ");const t=await get(env,`ticket:${tid}`,null);if(!t){await send(env,chat,"Ticket not found.");return;}await send(env,t.chat,"🎫 <b>Support reply</b>\n"+esc(msg));t.status="answered";await put(env,`ticket:${tid}`,t);await send(env,chat,"Reply sent.");return;}
  if (text==="/backup") {if(!isOwner(env,id))return;await makeBackup(env,chat);return;}
  if (text==="/analytics") {if(!isOwner(env,id))return;const keys=await env.BB_KV.list({prefix:"u:",limit:1000});let posts=0;for(const k of keys.keys){const x=await get(env,k.name,{});posts+=x.posts||0;}await send(env,chat,`📊 <b>Analytics</b>\nUsers stored: ${keys.keys.length}\nPublished post count (tracked): ${posts}\nDestinations: ${(await allDestinations(env)).length}`);return;}
  if (text==="/language") {await send(env,chat,"Choose language:",{reply_markup:{inline_keyboard:[[{text:"English",callback_data:"lang_en"},{text:"اردو",callback_data:"lang_ur"}]]}});return;}
  if (text.startsWith("/forward")) {if(!isOwner(env,id))return;const p=text.split(/\s+/);if(p[1]==="on"){await put(env,"autoforward",true);await send(env,chat,"Auto-forward enabled for configured source channels.");}else if(p[1]==="off"){await put(env,"autoforward",false);await send(env,chat,"Auto-forward disabled.");}else await send(env,chat,"Use /forward on or /forward off");return;}
  if (text==="/admin") {if(!isOwner(env,id))return;const ks=await env.BB_KV.list({prefix:"admin:",limit:100});await send(env,chat,"Sub-admins:\n"+ks.keys.map(k=>k.name.slice(6)).join("\n")+"\nAdd: /addadmin USER_ID\nRemove: /deladmin USER_ID");return;}
  if (text.startsWith("/addadmin ")) {if(!isOwner(env,id))return;const target=text.split(" ")[1];await put(env,`admin:${target}`,{permissions:["publish","analytics","tickets"]});await send(env,chat,"Sub-admin added with publish, analytics and tickets permissions.");return;}
  if (text.startsWith("/deladmin ")) {if(!isOwner(env,id))return;await del(env,`admin:${text.split(" ")[1]}`);await send(env,chat,"Sub-admin removed.");return;}
  if (text.startsWith("/")) {await send(env,chat,"Unknown command. Use /help or /menu.");return;}
  await send(env,chat,"Use /menu to open the control panel, or /new to create a post.");
}
async function processCallback(env,q) {
  const id=q.from.id,chat=q.message.chat.id,mid=q.message.message_id,data=q.data||"";
  if(data==="checkjoin"){if(await memberOK(env,id)){await answer(env,q.id,"Verified!");await showMenu(env,chat,id);}else{await answer(env,q.id,"Please join all required channels first.");}return;}
  if(!await joinGate(env,chat,id))return;
  if(data==="new"){await put(env,`state:${id}`,"draft_content");await answer(env,q.id);await send(env,chat,"Send post text/photo/video/document now.");return;}
  if(data==="drafts"){const d=await draft(env,id);await answer(env,q.id);await send(env,chat,d?`Draft ID: ${d.id}\nUse /preview, /addbutton, /publish.`:"No draft yet. Tap Create Post.");return;}
  if(data==="publish_help"){await answer(env,q.id);await send(env,chat,"Create a draft with /new, then publish using /publish. Destination channels: /addchannel @channel");return;}
  if(data==="schedule_help"){await answer(env,q.id);await send(env,chat,"Create a draft, then use /schedule YYYY-MM-DD HH:MM (UTC), /repeat daily HH:MM, or /repeat weekly mon HH:MM. Cron trigger required.");return;}
  if(data==="builder_help"){await answer(env,q.id);await send(env,chat,"Create post with /new. Add URL buttons: /addbutton Label | https://example.com. Preview: /preview.");return;}
  if(data==="channels"){await answer(env,q.id);const ds=await allDestinations(env);await send(env,chat,"Destinations:\n"+(ds.join("\n")||"None")+(isOwner(env,id)?"\nAdd with /addchannel @channel":""));return;}
  if(data==="referral"){await answer(env,q.id);await processMessage(env,{chat:{id:chat},from:{id},text:"/referral"});return;}
  if(data==="ticket"){await answer(env,q.id);await send(env,chat,"Open a ticket by sending:\n/ticket Your message");return;}
  if(data==="analytics"){await answer(env,q.id);await processMessage(env,{chat:{id:chat},from:{id},text:"/analytics"});return;}
  if(data==="backup"){await answer(env,q.id);await processMessage(env,{chat:{id:chat},from:{id},text:"/backup"});return;}
  if(data==="language"){await answer(env,q.id);await processMessage(env,{chat:{id:chat},from:{id},text:"/language"});return;}
  if(data==="help"){await answer(env,q.id);await processMessage(env,{chat:{id:chat},from:{id},text:"/help"});return;}
  if(data==="lang_en"||data==="lang_ur"){const u=await userData(env,id);u.lang=data==="lang_ur"?"ur":"en";await setUser(env,id,u);await answer(env,q.id,"Language saved");await send(env,chat,u.lang==="ur"?"زبان اردو منتخب ہو گئی۔":"English selected.");return;}
  await answer(env,q.id);
}
async function runJobs(env) {
  const jobs=await get(env,"jobs",[]),now=new Date(),keep=[];
  for(const j of jobs){
    let due=false;
    if(j.at){due=j.at<=Date.now();if(!due)keep.push(j);}
    else if(j.repeat){
      const hhmm=now.toISOString().slice(11,16),day=["sun","mon","tue","wed","thu","fri","sat"][now.getUTCDay()];
      const stamp=now.toISOString().slice(0,16);
      const last=await get(env,`joblast:${j.id}`,"");
      due=hhmm===j.time && (j.repeat==="daily" || (j.repeat==="weekly"&&day===j.day)) && last!==stamp;
      keep.push(j);
      if(due)await put(env,`joblast:${j.id}`,stamp);
    }
    if(due){const r=await publish(env,j.post);if(j.owner)await send(env,j.owner,r.ok?"⏰ Scheduled post published.":"❌ Scheduled post failed.");}
  }
  await put(env,"jobs",keep);
}
export default {
  async fetch(request,env) {
    if(!env.BOT_TOKEN||!env.ADMIN_ID||!env.BB_KV)return new Response("Missing BOT_TOKEN, ADMIN_ID or BB_KV binding.",{status:500});
    const url=new URL(request.url);
    if(request.method==="GET")return new Response("BUTTON BUILDER PRO — GALAXY VIP V6 MAX is online.");
    if(env.WEBHOOK_SECRET && url.searchParams.get("secret")!==env.WEBHOOK_SECRET)return new Response("Forbidden",{status:403});
    let update;try{update=await request.json();}catch{return new Response("Bad JSON",{status:400});}
    try{
      if(update.message)await processMessage(env,update.message);
      if(update.callback_query)await processCallback(env,update.callback_query);
      if(update.channel_post && await get(env,"autoforward",false)){
        const sources=(env.AUTO_FORWARD_SOURCES||"").split(",").map(x=>x.trim());
        if(!sources.length||sources.includes(String(update.channel_post.chat.id))){
          const msg=update.channel_post;
          for(const d of await allDestinations(env))await API(env,"copyMessage",{chat_id:d,from_chat_id:msg.chat.id,message_id:msg.message_id});
        }
      }
    }catch(e){if(update.message?.chat?.id)await send(env,update.message.chat.id,"⚠️ Error processing request. Check Worker Logs and bindings.");}
    return new Response("OK");
  },
  async scheduled(event,env,ctx){ctx.waitUntil(runJobs(env));}
};
