require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { exec } = require('child_process');
const app = express();

/* ─────────────────────────────────────────────
   SUPABASE + STRIPE
───────────────────────────────────────────── */
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/* ─────────────────────────────────────────────
   WEBHOOKS (MUST BE FIRST)
───────────────────────────────────────────── */
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
      await supabase.from('profiles')
        .update({ payment_pending: false })
        .eq('id', userId);
    }
  }
  res.json({ received: true });
});

/* ─────────────────────────────────────────────
   NORMAL MIDDLEWARE
───────────────────────────────────────────── */
app.use(express.json());

/* ─────────────────────────────────────────────
   TALKJS (UNCHANGED)
───────────────────────────────────────────── */
const TalkJS = require('talkjs');
app.post('/talkjs-token', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.sendStatus(401);
  const token = authHeader.split(' ')[1];
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return res.sendStatus(401);
  const signature = TalkJS.signUser({
    id: user.id,
    name: user.email
  }, process.env.TALKJS_SECRET_KEY);
  res.json({ token: signature });
});

/* ─────────────────────────────────────────────
   COMPRESSOR BACKEND (SERVER-SIDE FFmpeg)
───────────────────────────────────────────── */
const COMPRESS_ROOT = path.join(os.tmpdir(), 'rhythm-compressor');
fs.mkdirSync(COMPRESS_ROOT, { recursive: true });
const upload = multer({
  dest: path.join(os.tmpdir(), 'compress-chunks'),
  limits: { fileSize: 200 * 1024 * 1024 }
});

/* Upload chunk */
app.post('/compress/upload-chunk', upload.single('chunk'), (req, res) => {
  console.log('Upload chunk hit! fileId:', req.body.fileId, 'index:', req.body.index);
  const { fileId, index } = req.body;
  if (!fileId) return res.status(400).send('Missing fileId');
  const dir = path.join(COMPRESS_ROOT, fileId);
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(
    req.file.path,
    path.join(dir, `chunk_${index}`)
  );
  res.json({ ok: true });
});

/* Start compression */
app.post('/compress/start', async (req, res) => {
  console.log('Start compression hit! fileId:', req.body.fileId);
  const {
    fileId,
    crf = 23,
    hevc = false,
    width,
    height,
    output = 'zip'
  } = req.body;

  const dir = path.join(COMPRESS_ROOT, fileId);
  const input = path.join(dir, 'input.mp4');

  try {
    // Reassemble chunks into full input video
    const chunks = fs.readdirSync(dir)
      .filter(f => f.startsWith('chunk_'))
      .sort((a, b) => a.localeCompare(b));

    const write = fs.createWriteStream(input);
    for (const c of chunks) {
      write.write(fs.readFileSync(path.join(dir, c)));
    }
    write.end();
    await new Promise(r => write.on('finish', r));

    // Split into 15-minute segments
    const segmentsDir = path.join(dir, 'segments');
    fs.mkdirSync(segmentsDir);
    await execPromise(
      `ffmpeg -i "${input}" -map 0 -c copy -f segment -segment_time 900 "${segmentsDir}/part_%03d.mp4"`
    );

    // Compress each segment
    const compressedDir = path.join(dir, 'compressed');
    fs.mkdirSync(compressedDir);
    const parts = fs.readdirSync(segmentsDir);
    const totalParts = parts.length;
    let completed = 0;

    for (const p of parts) {
      const scale = width && height ? `-vf scale=${width}:${height}` : '';
      const codec = hevc ? 'libx265' : 'libx264';

      // Update progress before processing this segment
      fs.writeFileSync(
        path.join(dir, 'progress.json'),
        JSON.stringify({ percent: Math.round((completed / totalParts) * 100) })
      );

      await execPromise(
        `ffmpeg -i "${segmentsDir}/${p}" ${scale} -c:v ${codec} -crf ${crf} -preset medium -c:a copy "${compressedDir}/${p}"`
      );

      completed++;

      // Update progress after this segment
      fs.writeFileSync(
        path.join(dir, 'progress.json'),
        JSON.stringify({ percent: Math.round((completed / totalParts) * 100) })
      );
    }

    // Final 100%
    fs.writeFileSync(
      path.join(dir, 'progress.json'),
      JSON.stringify({ percent: 100 })
    );

    // Prepare final output (ZIP or merged MP4)
    let finalFile;
    if (output === 'mp4') {
      const list = parts.map(p => `file '${compressedDir}/${p}'`).join('\n');
      fs.writeFileSync(path.join(dir, 'list.txt'), list);
      finalFile = path.join(dir, 'final.mp4');
      await execPromise(
        `ffmpeg -f concat -safe 0 -i "${dir}/list.txt" -c copy "${finalFile}"`
      );
    } else {
      finalFile = path.join(dir, 'album.zip');
      await execPromise(
        `cd "${compressedDir}" && zip -r "${finalFile}" .`
      );
    }

    res.json({
      ok: true,
      download: `/compress/download/${fileId}`
    });
  } catch (err) {
    console.error('Compression error:', err);
    res.status(500).json({ error: 'Compression failed' });
  }
});

/* Progress polling endpoint */
app.get('/compress/progress', (req, res) => {
  const fileId = req.query.fileId;
  if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

  const progressFile = path.join(COMPRESS_ROOT, fileId, 'progress.json');

  if (fs.existsSync(progressFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      res.json({ progress: data.percent || 0 });
    } catch (e) {
      res.json({ progress: 0 });
    }
  } else {
    res.json({ progress: 0 });
  }
});

/* Download & cleanup */
app.get('/compress/download/:fileId', (req, res) => {
  const dir = path.join(COMPRESS_ROOT, req.params.fileId);
  const file = fs.readdirSync(dir).find(f => f.endsWith('.zip') || f.endsWith('.mp4'));
  if (!file) return res.sendStatus(404);
  res.download(path.join(dir, file), () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ─────────────────────────────────────────────
   STATIC FILES & FALLBACK – MUST BE LAST
───────────────────────────────────────────── */
app.use(express.static(__dirname, {
  index: false,
  extensions: ['html']
}));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* Catch-all 404 */
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

/* ───────────────────────────────────────────── */
function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => err ? reject(err) : resolve());
  });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Rhythm Deck live on port ${PORT}`);
});