// bot-and-server.js

require('dotenv').config();
const express     = require('express');
const path        = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const fs          = require('fs-extra');
const nodemailer  = require('nodemailer');
const fetch       = require('node-fetch');  // <-- node-fetch v2 (CommonJS)

//////////////////////////////////////
// ─── CONFIGURATION ────────────────────────────────────────────────────────────
//////////////////////////////////////

const BOT_TOKEN     = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const PORT          = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, 'codes.json');

// Mistral API credentials
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const AGENT_ID        = process.env.AGENT_ID;

if (
  !BOT_TOKEN ||
  !ADMIN_CHAT_ID ||
  !process.env.MAIL_USER ||
  !process.env.MAIL_PASS ||
  !MISTRAL_API_KEY ||
  !AGENT_ID
) {
  console.error('❌ Missing .env keys. Required:');
  console.error('   BOT_TOKEN, ADMIN_CHAT_ID, MAIL_USER, MAIL_PASS, MISTRAL_API_KEY, AGENT_ID');
  process.exit(1);
}

// Ensure the JSON database file exists
fs.ensureFileSync(DATA_FILE);
if (fs.readJSONSync(DATA_FILE, { throws: false }) === null) {
  fs.writeJSONSync(DATA_FILE, []);
}

//////////////////////////////////////
// ─── EMAIL (Gmail via STARTTLS 587) ────────────────────────────────────────────
//////////////////////////////////////

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // use STARTTLS
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// Verify SMTP configuration once at startup
transporter.verify(err => {
  if (err) {
    console.error('❌ SMTP Error:', err);
    process.exit(1);
  }
  console.log('✅ SMTP ready');
});

//////////////////////////////////////
// ─── EXPRESS SERVER ────────────────────────────────────────────────────────────
//////////////////////////////////////

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * POST /validate-code
 *   Input: { code: "ABC12345" }
 *   Response: { ok: true, subject: "Web Design & Development", plan: "premium" }
 *             or       { ok: false }
 */
app.post('/validate-code', (req, res) => {
  const { code } = req.body;
  const records = fs.readJSONSync(DATA_FILE);
  const now     = Date.now();

  // Find a matching, unexpired record
  const rec = records.find(
    r => r.code === code && r.expires > now
  );

  if (rec) {
    return res.json({
      ok: true,
      subject: rec.subject,
      plan:    rec.plan
    });
  } else {
    return res.json({ ok: false });
  }
});

/**
 * POST /api-chat
 *   Input: { message: "...", subject: "Web Design & Development" }
 *   Response: { reply: "AI's answer..." }
 * Only premium users (dashboard UI) should call this.
 */
app.post('/api-chat', async (req, res) => {
  const { message, subject } = req.body;
  if (!message || !subject) {
    return res.status(400).json({ error: 'Missing message or subject' });
  }

  try {
    const apiRes = await fetch(
      `https://api.mistral.ai/v1/agents/${AGENT_ID}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          // Prepend subject so the AI knows the context
          input: `(Subject: ${subject}) ${message}`
        })
      }
    );
    const payload = await apiRes.json();
    const reply = payload.choices?.[0]?.message?.content || 'Sorry, I cannot answer right now.';
    return res.json({ reply });
  } catch (err) {
    console.error('❌ Mistral API error:', err);
    return res.status(500).json({ error: 'Mistral request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ HTTP server listening on http://localhost:${PORT}`);
});

//////////////////////////////////////
// ─── TELEGRAM BOT ──────────────────────────────────────────────────────────────
//////////////////////////////////////

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/**
 * When a user sends a photo (payment screenshot),
 *  the bot forwards it to the admin chat with Approve/Decline buttons.
 * The caption MUST include lines:
 *   Email: user@example.com
 *   Subject: Web Design & Development
 *   Plan: premium    (or "normal")
 */
bot.on('photo', async (msg) => {
  const fileId  = msg.photo.pop().file_id;
  const caption = msg.caption || '';
  try {
    await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve',  callback_data: 'approve'  },
          { text: '❌ Decline', callback_data: 'decline' }
        ]]
      }
    });
    console.log('🔄 Forwarded payment to admin');
  } catch (e) {
    console.error('❌ Forward error:', e);
  }
});

bot.on('callback_query', async (q) => {
  const raw    = q.data || '';
  const action = raw.trim().toLowerCase();
  const adminId = q.from.id.toString();
  const chatId  = q.message.chat.id;
  const msgId   = q.message.message_id;

  if (adminId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(q.id, { text: '❌ Not authorized.' });
  }

  // Extract the three lines from the caption:
  //   Email: user@example.com
  //   Subject: Web Design & Development
  //   Plan: premium
  const caption   = q.message.caption || '';
  const emailM    = caption.match(/Email:\s*(\S+)/i);
  const subjectM  = caption.match(/Subject:\s*(.+?)(?:\n|$)/i);
  const planM     = caption.match(/Plan:\s*(\S+)/i);

  const email   = emailM   ? emailM[1]         : null;
  const subject = subjectM ? subjectM[1].trim() : 'Unknown';
  const plan    = planM    ? planM[1].trim().toLowerCase() : 'normal';

  console.log(`▶️ callback: ${action}, email=${email}, subject=${subject}, plan=${plan}`);

  if (!email) {
    await bot.answerCallbackQuery(q.id, { text: '⚠️ No Email found.' });
    return;
  }

  if (action === 'approve') {
    // APPROVE branch
    const code    = uuidv4().split('-')[0].toUpperCase();
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const records = fs.readJSONSync(DATA_FILE);

    records.push({ code, email, subject, plan, expires });
    fs.writeJSONSync(DATA_FILE, records, { spaces: 2 });
    console.log(`➕ Stored: code=${code}, email=${email}, subject=${subject}, plan=${plan}`);

    // Send approval email
    try {
      const info = await transporter.sendMail({
        from: process.env.MAIL_USER,
        to:   email,
        subject: '✅ Your SkillCraft Access Code',
        text: `Hello,

Your payment has been approved! 🎉

Subject: ${subject}
Plan: ${plan.charAt(0).toUpperCase() + plan.slice(1)}
Your access code: ${code}
Valid until: ${new Date(expires).toLocaleDateString()}

Use this on the login page to access your ${plan === 'premium' ? 'AI-powered interactive lessons' : 'video-based lessons'}.

— SkillCraft Academy`
      });
      console.log('✅ Approval email sent:', info.messageId);
    } catch (err) {
      console.error('❌ Error sending approval email:', err);
    }

    // Update the admin’s message to remove buttons and show status
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    await bot.editMessageCaption(
      caption + `\n\n✅ *Approved & code emailed.*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(q.id);
  }

  if (action === 'decline') {
    // DECLINE branch: notify user via email
    try {
      const info = await transporter.sendMail({
        from: process.env.MAIL_USER,
        to:   email,
        subject: '❌ Payment Declined',
        text: `Hello,

Your payment submission was declined. Please verify your payment and resubmit.

— SkillCraft Academy`
      });
      console.log('✅ Decline email sent:', info.messageId);
    } catch (err) {
      console.error('❌ Error sending decline email:', err);
    }

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    await bot.editMessageCaption(
      caption + `\n\n❌ *Declined & email sent.*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(q.id);
  }

  // Unknown action
  console.warn('⚠️ Unknown action:', action);
  bot.answerCallbackQuery(q.id, { text: 'Unknown action.' });
});
