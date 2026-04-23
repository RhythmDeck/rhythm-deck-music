// pages/api/start.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL;
const INTERNAL_JOB_SECRET = process.env.INTERNAL_JOB_SECRET;
const BUCKET = 'video-uploads';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sanitizeFileId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9-_]/g, '');
}

function sanitizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return 'video.mp4';
  // Keep safe for metadata only (not filesystem path usage)
  return name.replace(/[^\w.\- ]+/g, '').trim().slice(0, 200) || 'video.mp4';
}

function sanitizeSettings(input = {}) {
  const presets = new Set(['ultrafast', 'veryfast', 'faster', 'fast', 'medium']);
  const bitrates = new Set(['96k', '128k', '160k', '192k', '256k', '320k']);
  const sampleRates = new Set([44100, 48000]);
  const channels = new Set([1, 2]);
  const fpsAllowed = new Set([24, 30, 60]);
  const scales = new Set([1, 0.75, 0.5]);

  const crfRaw = Number(input.crf);
  const crf = Number.isFinite(crfRaw) ? crfRaw : 23;

  const audioSampleRateRaw = Number(input.audioSampleRate);
  const audioChannelsRaw = Number(input.audioChannels);
  const fpsCapRaw =
    input.fpsCap === null || input.fpsCap === '' ? null : Number(input.fpsCap);
  const resolutionScaleRaw = Number(input.resolutionScale);

  return {
    crf: Math.min(30, Math.max(18, crf)),
    audioBitrate: bitrates.has(input.audioBitrate) ? input.audioBitrate : '128k',
    audioSampleRate: sampleRates.has(audioSampleRateRaw) ? audioSampleRateRaw : 44100,
    audioChannels: channels.has(audioChannelsRaw) ? audioChannelsRaw : 2,
    videoPreset: presets.has(input.videoPreset) ? input.videoPreset : 'veryfast',
    fpsCap: fpsAllowed.has(fpsCapRaw) ? fpsCapRaw : null,
    resolutionScale: scales.has(resolutionScaleRaw) ? resolutionScaleRaw : 1,
    normalizeAudio: Boolean(input.normalizeAudio),
  };
}

async function writeProgress(fileId, payload) {
  const path = `uploads/${fileId}/progress.json`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, JSON.stringify(payload), {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });

  if (error) {
    throw new Error(`Failed writing progress.json: ${error.message}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!APP_BASE_URL || !INTERNAL_JOB_SECRET) {
    return res.status(500).json({
      error: 'APP_BASE_URL and INTERNAL_JOB_SECRET must be set',
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set',
    });
  }

  try {
    const body = req.body || {};

    const fileId = sanitizeFileId(body.fileId);
    const totalChunks = Number(body.totalChunks);
    const originalName = sanitizeFilename(body.originalName);
    const settings = body.settings || {};

    if (!fileId) {
      return res.status(400).json({ error: 'Valid fileId is required' });
    }

    if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
      return res.status(400).json({ error: 'Valid totalChunks is required' });
    }

    const safeSettings = sanitizeSettings(settings);

    // 1) Mark as queued immediately
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

    // 2) Trigger compress endpoint (await so Vercel doesn't drop it)
    const url = `${APP_BASE_URL.replace(/\/+$/, '')}/api/compress-video`;

    const response = await fetch(url, {
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
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(
        `compress-video failed with status ${response.status}${
          bodyText ? `: ${bodyText}` : ''
        }`
      );
    }

    return res.status(200).json({ ok: true, fileId });
  } catch (err) {
    // Best effort: write startup error
    try {
      const body = req.body || {};
      const fileId = sanitizeFileId(body.fileId);

      if (fileId) {
        await writeProgress(fileId, {
          state: 'error',
          progress: 100,
          message: `Failed to start job: ${err?.message || 'Unknown error'}`,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('Failed to write startup error progress:', e);
    }

    return res.status(500).json({
      error: err?.message || 'Unexpected error',
    });
  }
}