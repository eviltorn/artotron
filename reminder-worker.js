// Cloudflare Worker для щоденних нагадувань Artotron
// 1. Створи KV Namespace (наприклад, REMINDERS_KV) і прив'яжи до Worker як змінну REMINDERS_KV
// 2. Додай Secret змінну BOT_TOKEN з токеном основного бота Artotron
// 3. Додай Cron Trigger: 0 * * * * (щогодини)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();
      const userId = Number(body.userId);
      const hour = Number(body.hour);
      const tzOffset = Number(body.tzOffset) || 0;
      const enabled = Boolean(body.enabled);

      if (!Number.isFinite(userId) || !Number.isFinite(hour) || hour < 0 || hour > 23) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const key = `user:${userId}`;
      const existing = await env.REMINDERS_KV.get(key, { type: 'json' });
      const record = {
        userId,
        enabled,
        hour,
        tzOffset,
        lastSentDate: existing?.lastSentDate || ''
      };
      await env.REMINDERS_KV.put(key, JSON.stringify(record));

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: 'Bad Request' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  },

  async scheduled(_event, env) {
    const nowUtcMs = Date.now();
    let cursor;

    do {
      const list = await env.REMINDERS_KV.list({ prefix: 'user:', cursor });
      cursor = list.list_complete ? undefined : list.cursor;

      for (const item of list.keys) {
        const rec = await env.REMINDERS_KV.get(item.name, { type: 'json' });
        if (!rec || !rec.enabled) continue;

        const localDate = new Date(nowUtcMs + (Number(rec.tzOffset) || 0) * 60000);
        const localHour = localDate.getUTCHours();
        const todayStr = localDate.toISOString().slice(0, 10);

        if (localHour !== rec.hour || rec.lastSentDate === todayStr) continue;

        const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: rec.userId,
            text: '🎨 Пора малювати! Зазирни в Артотрон за свіжою ідеєю.',
            reply_markup: {
              inline_keyboard: [[
                { text: '✨ Крутити Артотрон', web_app: { url: 'https://eviltorn.github.io/artotron/' } }
              ]]
            }
          })
        });

        if (res.ok) {
          rec.lastSentDate = todayStr;
          await env.REMINDERS_KV.put(item.name, JSON.stringify(rec));
        }
      }
    } while (cursor);
  }
};
