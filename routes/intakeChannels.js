const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/intakeChannels missing dependency: ${name}`);
  return value;
}

module.exports = function createIntakeChannelsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const INTAKE_AI_ENABLED = required('INTAKE_AI_ENABLED', deps.INTAKE_AI_ENABLED);
  const intake = required('intake', deps.intake);
  const webhookLimiter = required('webhookLimiter', deps.webhookLimiter);
  const verifyWhatsAppSignature = required('verifyWhatsAppSignature', deps.verifyWhatsAppSignature);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);

  router.get('/intake/whatsapp', webhookLimiter, (req, res) => {
    // Meta webhook verification
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  router.post('/intake/whatsapp', webhookLimiter, verifyWhatsAppSignature, async (req, res) => {
    res.sendStatus(200); // acknowledge immediately (Meta requires fast response)
    try {
      const body = req.body;
      const entry = body.entry?.[0]?.changes?.[0]?.value;
      if (!entry?.messages) return;

      for (const msg of entry.messages) {
        const fromPhone = msg.from;
        let parsed = null;

        if (msg.type === 'text') {
          parsed = intake.parseWhatsAppMessage(msg.text.body);
          parsed.source = 'whatsapp';
          parsed.customerPhone = fromPhone;
        } else if (msg.type === 'image' || msg.type === 'document') {
          // Image/PDF - would need to download via WhatsApp API then OCR
          // Mark for manual review
          db.prepare('INSERT INTO intake_log (source,raw_content,status) VALUES (?,?,?)')
            .run('whatsapp_media', `media:${msg.type} from:${fromPhone}`, 'pending_review');
          await intake.sendWhatsApp(fromPhone, 'קיבלנו את התמונה, ניצור קשר בהקדם!');
          continue;
        }

        if (parsed) {
          db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
            .run('whatsapp', msg.text?.body || '', JSON.stringify(parsed), 'pending_review');
          wsBroadcast('new_intake', { source: 'whatsapp', phone: fromPhone, parsed });
        }
      }
    } catch (err) {
      console.error('[WhatsApp webhook]', err.message);
    }
  });

  router.post('/intake/email/poll', requireAnyRole(['office', 'manager', 'admin']), async (req, res) => {
    if (!INTAKE_AI_ENABLED) return res.status(501).json({ error: 'Email intake לא זמין בשלב זה', feature: 'intake-ai' });
    try {
      const results = await intake.pollEmail(db);
      res.json({ success: true, count: results.length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
