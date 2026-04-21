// pages/api/start.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL;
const INTERNAL_JOB_SECRET = process.env.INTERNAL_JOB_SECRET;
const BUCKET = 'video-uploads';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sanitizeSettings(input = {}) {
  const presets = new Set(['ultrafast', 'veryfast', 'faster', 'fast', 'medium']);
  const bitrates = new Set(['96k', '128k', '160k', '192k', '256k', '320k']);
  const sampleRates = new Set([44100, 48000]);
  const channels = new Set([1, 2]);
  const fpsAllowed = new Set([24, 30, 60]);
  const scales = new Set([1, 0.75, 0.5]);

  const crf = Number.isFinite(Number(input.crf)) ? Number(input.crf) : 23;

  return {
    crf: Math.min(30, Math.max(18, crf)),
    audioBitrate: bitrates.has(input.audioBitrate) ? input.audioBitrate : '128k',
    audioSampleRate: sampleRates.has(Number(input.audioSampleRate))
      ? Number(input.audioSampleRate)
      : 44100,
    audioChannels: channels.has(Number(input.audioChannels)) ? Number(input.audioChannels) : 2,
    videoPreset: presets.has(input.videoPreset) ? input.videoPreset : 'veryfast',
    fpsCap: fpsAllowed.has(Number(input.fpsCap)) ? Number(input.fpsCap) : null,
    resolutionScale: scales.has(Number(input.resolutionScale)) ? Number(input.resolutionScale) : 1,
    normalizeAudio: Boolean(input.normalizeAudio),
  };
}

async function writeProgress(fileId, payload) {
  const path = `uploads/${fileId}/progress.json`;
  await supabaseAdmin.storage.from(BUCKET).upload(path, JSON.stringify(payload), {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!APP_BASE_URL || !INTERNAL_JOB_SECRET) {
    return res.status(500).json({ error: 'APP_BASE_URL and INTERNAL_JOB_SECRET must be set' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set' });
  }

  try {
    const { fileId, totalChunks, originalName, settings } = req.body || {};
    if (!fileId || !Number.isInteger(totalChunks) || totalChunks <= 0 || !originalName) {
      return res.status(400).json({ error: 'fileId, totalChunks, and originalName are required' });
    }

    const safeSettings = sanitizeSettings(settings);

    await writeProgress(fileId, {
      state: 'queued',
      progress: 0,
      message: 'Job queued',
      fileId,
      totalChunks,
      originalName,
      settings: safeSettings,
      updatedAt: new Date().toISOString(),
    });

    const url = `${APP_BASE_URL.replace(/\/+$/, '')}/api/compress-video`;

    // Fire-and-forget
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-job-secret': INTERNAL_JOB_SECRET,
      },
      body: JSON.stringify({
        fileId,
        totalChunks,
        originalName,
        settings: safeSettings,
      }),
    }).catch(async (err) => {
      await writeProgress(fileId, {
        state: 'error',
        progress: 100,
        message: `Failed to start job: ${err.message}`,
        updatedAt: new Date().toISOString(),
      });
    });

    return res.status(200).json({ ok: true, fileId });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}