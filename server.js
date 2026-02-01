require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const stripeLib = require('stripe');
const TalkJS = require('talkjs');
const app = express();

/* ─────────────────────────────────────────────
   SUPABASE + STRIPE
───────────────────────────────────────────── */
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);

/* ─────────────────────────────────────────────
   STRIPE WEBHOOK (MUST BE FIRST)
───────────────────────────────────────────── */
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(err.message);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;

      if (userId) {
        await supabase
          .from('profiles')
          .update({ payment_pending: false })
          .eq('id', userId);
      }
    }

    res.json({ received: true });
  }
);

/* ─────────────────────────────────────────────
   NORMAL MIDDLEWARE
───────────────────────────────────────────── */
app.use(express.json());

/* ─────────────────────────────────────────────
   STRIPE CHECKOUT – VIDEO COMPRESSOR (FIXED)
───────────────────────────────────────────── */
app.post('/create-compressor-checkout', async (req, res) => {
  try {
    const { plan, email, name } = req.body;

    if (!plan) {
      return res.status(400).json({ error: 'Missing plan' });
    }

    let priceId;

    if (plan === 'monthly') {
      priceId = process.env.STRIPE_COMPRESSOR_PRICE_ID_MONTHLY;
    } else if (plan === 'yearly') {
      priceId = process.env.STRIPE_COMPRESSOR_PRICE_ID_YEARLY;
    } else {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',

      customer_email: email,

      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],

      metadata: {
        product: 'video_compressor',
        plan,
        name
      },

      success_url: `${process.env.BASE_URL}/compressor.html?success=1`,
      cancel_url: `${process.env.BASE_URL}/signup-to-compressor.html?canceled=1`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout Error:', err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

/* ─────────────────────────────────────────────
   TALKJS
───────────────────────────────────────────── */
app.post('/talkjs-token', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.sendStatus(401);

  const token = authHeader.split(' ')[1];
  const {
    data: { user }
  } = await supabase.auth.getUser(token);

  if (!user) return res.sendStatus(401);

  const signature = TalkJS.signUser(
    {
      id: user.id,
      name: user.email
    },
    process.env.TALKJS_SECRET_KEY
  );

  res.json({ token: signature });
});

/* ─────────────────────────────────────────────
   COMPRESSOR BACKEND
───────────────────────────────────────────── */
const COMPRESS_ROOT = path.join(os.tmpdir(), 'rhythm-compressor');
fs.mkdirSync(COMPRESS_ROOT, { recursive: true });

const upload = multer({
  dest: path.join(os.tmpdir(), 'compress-chunks'),
  limits: { fileSize: 200 * 1024 * 1024 }
});

/* Upload chunk */
app.post('/compress/upload-chunk', upload.single('chunk'), (req, res) => {
  const { fileId, index } = req.body;
  if (!fileId) return res.status(400).send('Missing fileId');

  const dir = path.join(COMPRESS_ROOT, fileId);
  fs.mkdirSync(dir, { recursive: true });

  fs.renameSync(req.file.path, path.join(dir, `chunk_${index}`));
  res.json({ ok: true });
});

/* Start compression */
app.post('/compress/start', async (req, res) => {
  const { fileId, crf = 23, hevc = false } = req.body;
  const dir = path.join(COMPRESS_ROOT, fileId);
  const input = path.join(dir, 'input.mp4');

  try {
    const chunks = fs
      .readdirSync(dir)
      .filter(f => f.startsWith('chunk_'))
      .sort();

    const write = fs.createWriteStream(input);
    for (const c of chunks) {
      write.write(fs.readFileSync(path.join(dir, c)));
    }
    write.end();
    await new Promise(r => write.on('finish', r));

    const output = path.join(dir, 'final.mp4');

    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .videoCodec(hevc ? 'libx265' : 'libx264')
        .addOption('-crf', crf)
        .output(output)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    res.json({ ok: true, download: `/compress/download/${fileId}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Compression failed' });
  }
});

/* Download */
app.get('/compress/download/:fileId', (req, res) => {
  const dir = path.join(COMPRESS_ROOT, req.params.fileId);
  const file = path.join(dir, 'final.mp4');

  if (!fs.existsSync(file)) return res.sendStatus(404);

  res.download(file, () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ─────────────────────────────────────────────
   STATIC FILES
───────────────────────────────────────────── */
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ───────────────────────────────────────────── */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Rhythm Deck live on port ${PORT}`);
});
