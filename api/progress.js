// pages/api/progress.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'video-uploads';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sanitizeFileId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9-_]/g, '');
}

async function readJsonObject(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;

  try {
    const text = await data.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function objectExists(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  return !error && !!data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set',
    });
  }

  try {
    const fileId = sanitizeFileId(req.query.fileId);
    if (!fileId) {
      return res.status(400).json({ error: 'Valid fileId is required' });
    }

    // 1) Prefer status.json (legacy compatibility)
    const status = await readJsonObject(`uploads/${fileId}/status.json`);
    if (status) {
      return res.status(200).json({ fileId, ...status });
    }

    // 2) Then progress.json (current source of truth)
    const progress = await readJsonObject(`uploads/${fileId}/progress.json`);
    if (progress) {
      return res.status(200).json({ fileId, ...progress });
    }

    // 3) Fallback: if output.mp4 exists, report done
    const hasOutput = await objectExists(`uploads/${fileId}/output.mp4`);
    if (hasOutput) {
      return res.status(200).json({
        fileId,
        state: 'done',
        progress: 100,
        message: 'Compression complete',
        outputPath: `uploads/${fileId}/output.mp4`,
      });
    }

    // 4) Nothing found yet
    return res.status(200).json({
      fileId,
      state: 'processing',
      progress: 0,
      message: 'No status found yet',
    });
  } catch (error) {
    console.error('progress error:', error);
    return res.status(500).json({
      error: error?.message || 'Unexpected progress error',
    });
  }
}