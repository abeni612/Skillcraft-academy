require('dotenv').config();
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const AGENT_ID = process.env.AGENT_ID;
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'codes.json');

// Validate .env
if (!BOT_TOKEN || !ADMIN_CHAT_ID || !process.env.MAIL_USER || !process.env.MAIL_PASS || !MISTRAL_API_KEY || !AGENT_ID) {
  console.error('❌ .env is missing required values');
  process.exit(1);
}

// Prepare data file
fs.ensureFileSync(DATA_FILE);
if (fs.readJSONSync(DATA_FILE, { throws: false }) === null) {
  fs.writeJSONSync(DATA_FILE, []);
}

// Email setup
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});
transporter.verify(err => {
  if (err) {
    console.error('❌ SMTP ERROR:', err);
    process.exit(1);
  } else {
    console.log('✅ SMTP ready');
  }
});

// Express setup
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Validate code
app.post('/validate-code', (req, res) => {
  const { code } = req.body;
  const records = fs.readJSONSync(DATA_FILE);
  const now = Date.now();
  const rec = records.find(r => r.code === code && r.expires > now);
  if (rec) {
    return res.json({ ok: true, subject: rec.subject, plan: rec.plan });
  } else {
    return res.json({ ok: false });
  }
});

// AI Chat (Premium)
app.post('/api-chat', async (req, res) => {
  const { message, subject } = req.body;
  if (!message || !subject) {
    return res.status(400).json({ error: 'Missing input' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const apiRes = await fetch(`https://api.mistral.ai/v1/agents/${AGENT_ID}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({ input: `(Subject: ${subject}) ${message}` })
    });

    const payload = await apiRes.json();
    const reply = payload.choices?.[0]?.message?.content || 'Sorry, no reply.';
    return res.json({ reply });
  } catch (err) {
    console.error('❌ Mistral API error:', err);
    return res.status(500).json({ error: 'AI failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

// Telegram Bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('photo', async (msg) => {
  const fileId = msg.photo.pop().file_id;
  const caption = msg.caption || '';
  try {
    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: 'approve' },
          { text: '❌ Decline', callback_data: 'decline' }
        ]]
      }
    });
    console.log('📩 Payment forwarded to admin');
  } catch (err) {
    console.error('❌ Error forwarding payment:', err);
  }
});

bot.on('callback_query', async (q) => {
  const action = q.data.trim().toLowerCase();
  const caption = q.message.caption || '';
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;

  if (q.from.id.toString() !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(q.id, { text: '❌ Not allowed' });
  }

  const email = caption.match(/Email:\s*(\S+)/i)?.[1];
  const subject = caption.match(/Subject:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
  const plan = caption.match(/Plan:\s*(\S+)/i)?.[1]?.toLowerCase();

  if (!email || !subject || !plan) {
    return bot.answerCallbackQuery(q.id, { text: '❌ Missing email/subject/plan' });
  }

  if (action === 'approve') {
    const code = uuidv4().split('-')[0].toUpperCase();
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const recs = fs.readJSONSync(DATA_FILE);
    recs.push({ code, email, subject, plan, expires });
    fs.writeJSONSync(DATA_FILE, recs, { spaces: 2 });

    try {
      await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: email,
        subject: '✅ Your SkillCraft Code',
        text: `Approved!\n\nSubject: ${subject}\nPlan: ${plan}\nAccess Code: ${code}\nValid Until: ${new Date(expires).toLocaleDateString()}`
      });
      console.log('✅ Approval email sent');
    } catch (e) {
      console.error('❌ Email failed:', e);
    }

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    await bot.editMessageCaption(caption + `\n\n✅ *Approved & code emailed.*`, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown'
    });
    return bot.answerCallbackQuery(q.id);
  }

  if (action === 'decline') {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: email,
        subject: '❌ Payment Declined',
        text: `Hello,\n\nYour payment was declined. Please retry.\n\n— SkillCraft`
      });
      console.log('✅ Decline email sent');
    } catch (e) {
      console.error('❌ Email failed:', e);
    }

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    await bot.editMessageCaption(caption + `\n\n❌ *Declined & email sent.*`, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown'
    });
    return bot.answerCallbackQuery(q.id);
  }

  bot.answerCallbackQuery(q.id, { text: 'Unknown action.' });
});
