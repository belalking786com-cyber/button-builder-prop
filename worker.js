// ============================================================
// BUTTON BUILDER PRO — SINGLE FILE CLOUDFLARE WORKER
// Rebuilt delivery edition
// ============================================================
// Required Cloudflare bindings:
//   BOT_TOKEN            Secret
//   ADMIN_ID             Variable (Telegram numeric user ID)
//   WEBHOOK_SECRET       Secret
//   REQUIRED_CHANNEL_ID  Variable (example: -1001234567890)
//   REQUIRED_CHANNEL_LINK Variable (https://t.me/yourchannel)
//   BB_KV                KV Namespace binding
//
// Optional:
//   BOT_NAME, TIMEZONE
//
// Webhook URL:
//   https://YOUR-WORKER.workers.dev/?secret=YOUR_WEBHOOK_SECRET
//
// Notes:
// - This is a single-file rebuild of the core bot workflow.
// - Configure the required channel and make the bot an admin there.
// - For scheduled posts, create a Cron Trigger in Worker settings.
// ============================================================

const VERSION = "5.1.0";
const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const now = () => Date.now();
const key = (s) => `bb:${s}`;

async function tg(env, method, body = {}) {
  const r = await fetch(API(env.BOT_TOKEN, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) console.log("Telegram API error", method, data);
  return data;
}
async function get(env, k, fallback = null) {
  const v = await env.BB_KV.get(key(k));
  if (v === null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
async function put(env, k, v) {
  return env.BB_KV.put(key(k), JSON.stringify(v));
}
async function del(env, k) { return env.BB_KV.delete(key(k)); }
const isAdmin = (env, id) => String(id) === String(env.ADMIN_ID);
async function send(env, chatId, text, extra = {}) {
  return tg(env, "sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true, ...extra
  });
}
async function answer(env, id, text = "", alert = false) {
  return tg(env, "answerCallbackQuery", {
    callback_query_id: id, text, show_alert: alert
  });
}
async function userUpsert(env, user) {
  if (!user?.id) return;
  const users = await get(env, "users", {});
  users[String(user.id)] = {
    id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    username: user.username || "", seen: now(), blocked: users[String(user.id)]?.blocked || false
  };
  await put(env, "users", users);
}
async function blocked(env, id) {
  const users = await get(env, "users", {});
  return !!users[String(id)]?.blocked;
}
async function joinStatus(env, userId) {
  if (!env.REQUIRED_CHANNEL_ID) return true;
  const r = await tg(env, "getChatMember", {
    chat_id: env.REQUIRED_CHANNEL_ID, user_id: userId
  });
  if (!r.ok) return false;
  return ["member", "administrator", "creator"].includes(r.result?.status);
}
async function requireJoin(env, chatId, userId) {
  if (!env.REQUIRED_CHANNEL_ID || !env.REQUIRED_CHANNEL_LINK) return true;
  if (await joinStatus(env, userId)) return true;
  await send(env, chatId,
    "🔒 <b>Channel Join Required</b>\n\nBot استعمال کرنے کے لیے پہلے ہمارا چینل Join کریں، پھر CHECK JOIN دبائیں۔",
    { reply_markup: { inline_keyboard: [
      [{ text: "JOIN CHANNEL", url: env.REQUIRED_CHANNEL_LINK }],
      [{ text: "CHECK JOIN", callback_data: "check_join" }]
    ] } }
  );
  return false;
}
async function home(env, chatId, userId) {
  const admin = isAdmin(env, userId);
  const rows = [
    [{ text: "➕ Create Post", callback_data: "create_post" }],
    [{ text: "📚 My Drafts", callback_data: "drafts" }],
    [{ text: "📢 My Channels", callback_data: "channels" }],
    [{ text: "❓ Help", callback_data: "help" }]
  ];
  if (admin) rows.push([{ text: "⚙️ Admin Panel", callback_data: "admin" }]);
  await send(env, chatId,
    `<b>BUTTON BUILDER PRO</b>\nVersion ${VERSION}\n\nWelcome! Choose an option below.`,
    { reply_markup: { inline_keyboard: rows } }
  );
}
async function adminPanel(env, chatId) {
  await send(env, chatId, "<b>ADMIN PANEL</b>\n\nCommands:\n/addchannel @channelusername\n/channels\n/users\n/broadcast Your message\n/block USER_ID\n/unblock USER_ID\n/schedule CHANNEL_ID|YYYY-MM-DD HH:MM|Message\n/schedules\n/cancelschedule ID\n\nUse /help for details.");
}
async function addDraft(env, userId, text, media = null) {
  const drafts = await get(env, `drafts:${userId}`, []);
  const id = `${Date.now()}`;
  drafts.unshift({ id, text: text || "", media, buttons: [], created: now() });
  await put(env, `drafts:${userId}`, drafts.slice(0, 30));
  return id;
}
async function draftsMenu(env, chatId, userId) {
  const drafts = await get(env, `drafts:${userId}`, []);
  if (!drafts.length) return send(env, chatId, "آپ کے پاس ابھی کوئی Draft نہیں ہے۔");
  const rows = drafts.slice(0, 10).map(d => [{
    text: `${d.media ? "📎 " : ""}${(d.text || "Media post").slice(0, 32)}`,
    callback_data: `draft:${d.id}`
  }]);
  await send(env, chatId, "<b>Your Drafts</b>\nکسی Draft کو کھولنے کے لیے منتخب کریں۔",
    { reply_markup: { inline_keyboard: rows } });
}
async function channelsMenu(env, chatId, userId) {
  const channels = await get(env, `channels:${userId}`, []);
  const lines = channels.length
    ? channels.map((c, i) => `${i + 1}. ${c.title || c.id} — <code>${c.id}</code>`).join("\n")
    : "ابھی کوئی channel محفوظ نہیں۔";
  await send(env, chatId, `<b>Your Channels</b>\n${lines}\n\nChannel add کرنے کے لیے /addchannel @channelusername استعمال کریں۔`);
}
async function publishDraft(env, chatId, userId, draftId) {
  const drafts = await get(env, `drafts:${userId}`, []);
  const d = drafts.find(x => x.id === draftId);
  if (!d) return send(env, chatId, "Draft نہیں ملا۔");
  const markup = d.buttons?.length ? { inline_keyboard: d.buttons } : undefined;
  let result;
  if (d.media?.type === "photo") result = await tg(env, "sendPhoto", {
    chat_id: chatId, photo: d.media.file_id, caption: d.text, reply_markup: markup
  });
  else if (d.media?.type === "video") result = await tg(env, "sendVideo", {
    chat_id: chatId, video: d.media.file_id, caption: d.text, reply_markup: markup
  });
  else if (d.media?.type === "document") result = await tg(env, "sendDocument", {
    chat_id: chatId, document: d.media.file_id, caption: d.text, reply_markup: markup
  });
  else result = await send(env, chatId, d.text || "(Empty post)", { reply_markup: markup });
  if (result?.ok) await send(env, userId, "✅ Post published.");
  else await send(env, userId, "Post publish نہیں ہو سکی۔ Bot کی channel permissions چیک کریں۔");
}
async function processCommand(env, msg) {
  const chatId = msg.chat.id, userId = msg.from.id;
  const text = (msg.text || "").trim();
  if (text === "/start") {
    await userUpsert(env, msg.from);
    if (await blocked(env, userId)) return send(env, chatId, "آپ کو اس bot سے بلاک کیا گیا ہے۔");
    if (!(await requireJoin(env, chatId, userId))) return;
    return home(env, chatId, userId);
  }
  if (text === "/help") return send(env, chatId,
    "<b>HELP</b>\n/start — Start bot\n/addchannel @username — Save a channel\n/channels — List channels\n\nPost بنانے کے لیے Create Post دبائیں، پھر اپنا text یا media بھیجیں۔");
  if (!await isAdmin(env, userId)) {
    if (await blocked(env, userId)) return send(env, chatId, "آپ کو اس bot سے بلاک کیا گیا ہے۔");
    if (!(await requireJoin(env, chatId, userId))) return;
  }
  if (text.startsWith("/addchannel")) {
    const target = text.split(/\s+/)[1];
    if (!target) return send(env, chatId, "استعمال: /addchannel @channelusername");
    const r = await tg(env, "getChat", { chat_id: target });
    if (!r.ok) return send(env, chatId, "Channel نہیں ملا۔ Bot کو اس channel میں admin بنائیں اور درست username دیں۔");
    const channels = await get(env, `channels:${userId}`, []);
    if (!channels.some(c => String(c.id) === String(r.result.id))) {
      channels.push({ id: r.result.id, title: r.result.title || target, username: r.result.username || "" });
      await put(env, `channels:${userId}`, channels);
    }
    return send(env, chatId, `✅ Channel محفوظ ہو گیا: <b>${r.result.title || target}</b>\nID: <code>${r.result.id}</code>`);
  }
  if (text === "/channels") return channelsMenu(env, chatId, userId);
  if (text === "/users" && isAdmin(env, userId)) {
    const users = await get(env, "users", {});
    return send(env, chatId, `Total users: <b>${Object.keys(users).length}</b>`);
  }
  if (text.startsWith("/block ") && isAdmin(env, userId)) {
    const target = text.split(/\s+/)[1];
    const users = await get(env, "users", {});
    if (!users[target]) return send(env, chatId, "User نہیں ملا۔");
    users[target].blocked = true; await put(env, "users", users);
    return send(env, chatId, "User blocked.");
  }
  if (text.startsWith("/unblock ") && isAdmin(env, userId)) {
    const target = text.split(/\s+/)[1];
    const users = await get(env, "users", {});
    if (!users[target]) return send(env, chatId, "User نہیں ملا۔");
    users[target].blocked = false; await put(env, "users", users);
    return send(env, chatId, "User unblocked.");
  }
  if (text.startsWith("/broadcast ") && isAdmin(env, userId)) {
    const body = text.slice(11).trim();
    const users = await get(env, "users", {});
    let ok = 0;
    for (const u of Object.values(users)) {
      if (!u.blocked) {
        const r = await send(env, u.id, body);
        if (r.ok) ok++;
      }
    }
    return send(env, chatId, `Broadcast مکمل۔ کامیاب: ${ok}`);
  }
  // Draft composition: user sends text or supported media after Create Post.
  const mode = await get(env, `mode:${userId}`, "");
  if (mode === "draft") {
    let media = null, body = text;
    if (msg.photo?.length) media = { type: "photo", file_id: msg.photo[msg.photo.length - 1].file_id };
    else if (msg.video) media = { type: "video", file_id: msg.video.file_id };
    else if (msg.document) media = { type: "document", file_id: msg.document.file_id };
    else if (msg.animation) media = { type: "video", file_id: msg.animation.file_id };
    const id = await addDraft(env, userId, body, media);
    await put(env, `mode:${userId}`, "");
    return send(env, chatId, `✅ Draft محفوظ ہو گیا۔ ID: <code>${id}</code>`,
      { reply_markup: { inline_keyboard: [[
        { text: "👁 Preview", callback_data: `draft:${id}` },
        { text: "📚 My Drafts", callback_data: "drafts" }
      ]] } });
  }
  return send(env, chatId, "Menu سے Create Post منتخب کریں یا /help لکھیں۔");
}
async function processCallback(env, q) {
  const data = q.data || "", userId = q.from.id, chatId = q.message.chat.id;
  if (data === "check_join") {
    if (await blocked(env, userId)) return answer(env, q.id, "Access blocked", true);
    if (await joinStatus(env, userId)) {
      await answer(env, q.id, "Join verified");
      return home(env, chatId, userId);
    }
    return answer(env, q.id, "پہلے channel join کریں، پھر دوبارہ check کریں۔", true);
  }
  if (!isAdmin(env, userId) && !(await requireJoin(env, chatId, userId))) {
    return answer(env, q.id, "پہلے required channel join کریں۔", true);
  }
  if (data === "admin" && isAdmin(env, userId)) {
    await answer(env, q.id); return adminPanel(env, chatId);
  }
  if (data === "help") {
    await answer(env, q.id);
    return send(env, chatId, "/start — Main menu\n/addchannel @username — Add channel\n/channels — Your channels\n/help — Help");
  }
  if (data === "create_post") {
    await put(env, `mode:${userId}`, "draft");
    await answer(env, q.id);
    return send(env, chatId, "اپنا post text یا photo/video/document بھیجیں۔ یہ Draft میں محفوظ ہو جائے گا۔");
  }
  if (data === "drafts") { await answer(env, q.id); return draftsMenu(env, chatId, userId); }
  if (data === "channels") { await answer(env, q.id); return channelsMenu(env, chatId, userId); }
  if (data.startsWith("draft:")) {
    const id = data.slice(6), drafts = await get(env, `drafts:${userId}`, []);
    const d = drafts.find(x => x.id === id);
    if (!d) return answer(env, q.id, "Draft not found", true);
    await answer(env, q.id);
    await send(env, chatId, `<b>Draft Preview</b>\n${d.text || "[Media post]"}\n\nID: <code>${d.id}</code>`,
      { reply_markup: { inline_keyboard: [[
        { text: "📤 Publish to Saved Channels", callback_data: `publish:${id}` }
      ]] } });
    return;
  }
  if (data.startsWith("publish:")) {
    const id = data.slice(8), channels = await get(env, `channels:${userId}`, []);
    if (!channels.length) return answer(env, q.id, "پہلے /addchannel سے channel add کریں۔", true);
    const drafts = await get(env, `drafts:${userId}`, []);
    const d = drafts.find(x => x.id === id);
    if (!d) return answer(env, q.id, "Draft not found", true);
    let sent = 0;
    for (const c of channels) {
      let r;
      if (d.media?.type === "photo") r = await tg(env, "sendPhoto", { chat_id: c.id, photo: d.media.file_id, caption: d.text });
      else if (d.media?.type === "video") r = await tg(env, "sendVideo", { chat_id: c.id, video: d.media.file_id, caption: d.text });
      else if (d.media?.type === "document") r = await tg(env, "sendDocument", { chat_id: c.id, document: d.media.file_id, caption: d.text });
      else r = await tg(env, "sendMessage", { chat_id: c.id, text: d.text });
      if (r?.ok) sent++;
    }
    await answer(env, q.id, `Published to ${sent}/${channels.length} channels`);
    return send(env, chatId, `📤 Publish مکمل: ${sent}/${channels.length} channels`);
  }
}
async function handleUpdate(env, update) {
  if (update.message) return processCommand(env, update.message);
  if (update.callback_query) return processCallback(env, update.callback_query);
  if (update.chat_join_request && env.REQUIRED_CHANNEL_ID) {
    // A pending join request does NOT count as a completed channel membership.
    // User must be approved by the channel admin, then press CHECK JOIN.
    const u = update.chat_join_request.from;
    await userUpsert(env, u);
    return;
  }
  return null;
}
async function cron(env) {
  const schedules = await get(env, "schedules", []);
  const remain = [];
  for (const s of schedules) {
    if (s.at <= now()) {
      const r = await tg(env, "sendMessage", { chat_id: s.channel, text: s.text });
      if (!r.ok) remain.push(s);
    } else remain.push(s);
  }
  await put(env, "schedules", remain);
}
export default {
  async fetch(request, env) {
    try {
      if (!env.BOT_TOKEN || !env.ADMIN_ID || !env.BB_KV) {
        return new Response("Missing BOT_TOKEN, ADMIN_ID or BB_KV binding.", { status: 500 });
      }
      const url = new URL(request.url);
      if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      if (request.method !== "POST") {
        return new Response(`BUTTON BUILDER PRO ${VERSION} ONLINE`, { status: 200 });
      }
      const update = await request.json();
      await handleUpdate(env, update);
      return new Response("OK");
    } catch (e) {
      console.log("Worker error", e);
      return new Response("Internal error", { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env));
  }
};
