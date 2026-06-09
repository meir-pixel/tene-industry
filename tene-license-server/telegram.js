'use strict';

/**
 * telegram.js — תיבת נכנס דרך בוט טלגרם.
 * מאיר והשותף שולחים הודעה לבוט → ההערה מתווספת ל-TASKS.md בריפו tene-industry
 * (סקשן "📥 נכנס"). לא נכנס כמשימת todo — כדי שהביצוע האוטונומי לא ייקח אותה לפני אישור.
 *
 * כל הסודות מ-Environment (לא בקוד):
 *   TELEGRAM_BOT_TOKEN        — מ-@BotFather
 *   TELEGRAM_ALLOWED_IDS      — chat ids מורשים, מופרדים בפסיק
 *   TELEGRAM_WEBHOOK_SECRET   — מחרוזת אקראית (אימות שההודעה מטלגרם)
 *   TELEGRAM_WEBHOOK_URL      — (אופציונלי) רישום webhook אוטומטי בעלייה
 *   GITHUB_TOKEN              — fine-grained PAT עם Contents: Read&Write לריפו
 *   TASKS_REPO                — ברירת מחדל meir-pixel/tene-industry
 *   TASKS_BRANCH              — ברירת מחדל main
 *   TASKS_PATH                — ברירת מחדל TASKS.md
 */

const INBOX_MARKER = '<!-- INBOX -->';

function createTelegramBot() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const GH_TOKEN  = process.env.GITHUB_TOKEN || '';
  const GH_REPO   = process.env.TASKS_REPO   || 'meir-pixel/tene-industry';
  const GH_BRANCH = process.env.TASKS_BRANCH || 'main';
  const GH_PATH   = process.env.TASKS_PATH   || 'TASKS.md';
  const SECRET    = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const ALLOWED   = (process.env.TELEGRAM_ALLOWED_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const enabled = !!(BOT_TOKEN && GH_TOKEN);

  const ghHeaders = {
    'Authorization': `Bearer ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'tene-telegram-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function tg(method, body) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch (e) {
      console.error('telegram api error', method, e.message);
      return null;
    }
  }

  // הוספת שורה לסקשן הנכנס, עם retry על התנגשות sha (כתיבה מקבילה)
  async function appendNote(note, author) {
    const url = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}`;
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const safe = String(note).replace(/\r?\n/g, ' ').trim().slice(0, 500);
    const line = `- [ ] ${safe}  _(${author}, ${date})_`;

    for (let attempt = 0; attempt < 4; attempt++) {
      const getRes = await fetch(`${url}?ref=${GH_BRANCH}`, { headers: ghHeaders });
      if (!getRes.ok) throw new Error(`github get ${getRes.status}`);
      const file = await getRes.json();
      const content = Buffer.from(file.content, 'base64').toString('utf8');

      const updated = content.includes(INBOX_MARKER)
        ? content.replace(INBOX_MARKER, `${INBOX_MARKER}\n${line}`)
        : `${content}\n\n## 📥 נכנס (ממתין לסידור)\n${INBOX_MARKER}\n${line}\n`;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { ...ghHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `inbox: הערה מ-${author} דרך טלגרם`,
          content: Buffer.from(updated, 'utf8').toString('base64'),
          sha: file.sha,
          branch: GH_BRANCH,
        }),
      });
      if (putRes.ok) return true;
      if (putRes.status === 409) continue; // sha התיישן — ננסה שוב
      throw new Error(`github put ${putRes.status} ${await putRes.text()}`);
    }
    throw new Error('github put failed after retries (conflict)');
  }

  // express handler ל-POST /api/telegram/webhook
  async function webhook(req, res) {
    if (SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
      return res.sendStatus(401);
    }
    res.sendStatus(200); // טלגרם דורש תגובה מהירה

    const msg = req.body && req.body.message;
    if (!msg || !msg.text) return;

    const chatId = String(msg.chat.id);
    const from = msg.from || {};
    const author = from.first_name || from.username || chatId;
    const text = msg.text.trim();

    try {
      // /start ו-/id זמינים לכולם — כדי שאפשר לגלות chat id ולמסור למאיר
      if (text === '/start' || text === '/id') {
        await tg('sendMessage', {
          chat_id: chatId,
          text: `שלום ${author}! 👋\nמזהה הצ'אט שלך: ${chatId}\n\nאם מאיר הוסיף אותך — פשוט שלח/י כל הערה והיא תתווסף ללוח המשימות.`,
        });
        return;
      }

      if (ALLOWED.length && !ALLOWED.includes(chatId)) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: `אינך מורשה לשלוח ללוח עדיין.\nמזהה הצ'אט שלך: ${chatId}\nמסור/י אותו למאיר כדי שיוסיף אותך.`,
        });
        return;
      }

      await appendNote(text, author);
      await tg('sendMessage', {
        chat_id: chatId,
        text: '✅ נוסף ללוח (סקשן "נכנס"). מאיר יסדר אותו למשימה.',
      });
    } catch (e) {
      console.error('telegram webhook error', e.message);
      await tg('sendMessage', {
        chat_id: chatId,
        text: '⚠️ קרתה שגיאה בהוספה ללוח. נסה/י שוב בעוד רגע או פנה/י למאיר.',
      });
    }
  }

  // רישום webhook אוטומטי בעלייה (אם הוגדר TELEGRAM_WEBHOOK_URL)
  async function registerWebhook() {
    if (!enabled) return;
    const target = process.env.TELEGRAM_WEBHOOK_URL;
    if (!target) return;
    const r = await tg('setWebhook', {
      url: target,
      secret_token: SECRET || undefined,
      allowed_updates: ['message'],
    });
    console.log('telegram setWebhook:', r && r.ok ? 'ok' : JSON.stringify(r));
  }

  return { enabled, webhook, registerWebhook, appendNote };
}

module.exports = { createTelegramBot, INBOX_MARKER };
