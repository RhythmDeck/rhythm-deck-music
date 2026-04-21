// pages/api/compress-video.js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_JOB_SECRET = process.env.INTERNAL_JOB_SECRET;
const BUCKET = 'video-uploads';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sanitizeFileId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9-_]/g, '');
}

function sanitizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return 'video.mp4';
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
  const fpsCapRaw = input.fpsCap === null || input.fpsCap === '' ? null : Number(input.fpsCap);
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

function run(cmd, args, onStderr) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    p.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });

    p.on('error', reject);

    p.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
    });
  });
}

async function writeProgress(fileId, payload) {
  const progressPath = `uploads/${fileId}/progress.json`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(
    progressPath,
    JSON.stringify(payload),
    {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    }
  );
  if (error) throw new Error(`Failed writing progress.json: ${error.message}`);
}

function hhmmssToSec(h, m, s) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

async function getDurationSeconds(inputPath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ];

  return new Promise((resolve) => {
    const p = spawn('ffprobe', args);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) ? n : 0);
    });
    p.on('error', () => resolve(0));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTERNAL_JOB_SECRET) {
    return res.status(500).json({
      error: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_JOB_SECRET must be set',
    });
  }

  if (req.headers['x-internal-job-secret'] !== INTERNAL_JOB_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const fileId = sanitizeFileId(body.fileId);
  const totalChunks = Number(body.totalChunks);
  const originalName = sanitizeFilename(body.originalName);
  const cfg = sanitizeSettings(body.settings || {});

  if (!fileId) {
    return res.status(400).json({ error: 'Valid fileId is required' });
  }
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    return res.status(400).json({ error: 'Valid totalChunks is required' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `compress-${fileId}-`));
  const inputPath = path.join(tmpDir, 'input.mp4');
  const outputPath = path.join(tmpDir, 'output.mp4');

  try {
    await writeProgress(fileId, {
      state: 'processing',
      progress: 5,
      message: 'Downloading chunks',
      updatedAt: new Date().toISOString(),
    });

    // Merge chunks into one local input file
    const fd = fs.openSync(inputPath, 'w');
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = `uploads/${fileId}/chunks/${String(i).padStart(6, '0')}.part`;
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(chunkPath);
        if (error || !data) {
          throw new Error(`Chunk ${i + 1} download failed: ${error?.message || 'Missing chunk'}`);
        }

        const buf = Buffer.from(await data.arrayBuffer());
        fs.writeSync(fd, buf);

        const mergeProgress = Math.round(5 + ((i + 1) / totalChunks) * 20); // 5..25
        await writeProgress(fileId, {
          state: 'processing',
          progress: mergeProgress,
          message: `Merging chunks ${i + 1}/${totalChunks}`,
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      fs.closeSync(fd);
    }

    await writeProgress(fileId, {
      state: 'processing',
      progress: 30,
      message: 'Starting FFmpeg compression',
      updatedAt: new Date().toISOString(),
    });

    const duration = await getDurationSeconds(inputPath);
    const vf = [];

    if (cfg.resolutionScale !== 1) {
      vf.push(`scale=trunc(iw*${cfg.resolutionScale}/2)*2:trunc(ih*${cfg.resolutionScale}/2)*2`);
    }

    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', cfg.videoPreset,
      '-crf', String(cfg.crf),
      '-c:a', 'aac',
      '-b:a', cfg.audioBitrate,
      '-ar', String(cfg.audioSampleRate),
      '-ac', String(cfg.audioChannels),
      '-movflags', '+faststart',
    ];

    if (cfg.fpsCap) ffmpegArgs.push('-r', String(cfg.fpsCap));
    if (vf.length) ffmpegArgs.push('-vf', vf.join(','));
    if (cfg.normalizeAudio) ffmpegArgs.push('-af', 'loudnorm=I=-14:TP=-1.5:LRA=11');

    ffmpegArgs.push(outputPath);

    // Throttle progress writes so storage isn't spammed
    let lastProgress = 30;
    let lastWrite = 0;

    await run('ffmpeg', ffmpegArgs, (stderrLine) => {
      if (!duration) return;
      const m = stderrLine.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return;

      const sec = hhmmssToSec(m[1], m[2], m[3]);
      const ratio = Math.max(0, Math.min(1, sec / duration));
      const p = Math.round(30 + ratio * 60); // 30..90

      const now = Date.now();
      if (p > lastProgress && now - lastWrite > 1000) {
        lastProgress = p;
        lastWrite = now;
        writeProgress(fileId, {
          state: 'processing',
          progress: p,
          message: `Compressing… ${p}%`,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    });

    await writeProgress(fileId, {
      state: 'processing',
      progress: 92,
      message: 'Uploading compressed file',
      updatedAt: new Date().toISOString(),
    });

    const outputStoragePath = `uploads/${fileId}/output.mp4`;
    const outBuffer = fs.readFileSync(outputPath);

    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(
      outputStoragePath,
      outBuffer,
      {
        upsert: true,
        contentType: 'video/mp4',
        cacheControl: '3600',
      }
    );
    if (uploadError) throw new Error(uploadError.message);

    await writeProgress(fileId, {
      state: 'done',
      progress: 100,
      message: 'Compression complete',
      outputPath: outputStoragePath,
      originalName,
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, fileId, outputPath: outputStoragePath });
  } catch (err) {
    try {
      await writeProgress(fileId, {
        state: 'error',
        progress: 100,
        message: err?.message || 'Compression failed',
        updatedAt: new Date().toISOString(),
      });
    } catch {}
    return res.status(500).json({ error: err?.message || 'Compression failed' });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}