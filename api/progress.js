import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'video-uploads';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const fileIdRaw = req.query.fileId;

    if (!fileIdRaw || typeof fileIdRaw !== 'string') {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const fileId = fileIdRaw.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!fileId) {
      return res.status(400).json({ error: 'invalid fileId' });
    }

    // 1) Check status.json first
    const statusPath = `uploads/${fileId}/status.json`;
    const { data: statusFile, error: statusErr } = await supabase.storage
      .from(BUCKET)
      .download(statusPath);

    if (!statusErr && statusFile) {
      try {
        const text = await statusFile.text();
        const json = JSON.parse(text);
        return res.status(200).json({ fileId, ...json });
      } catch {
        // bad JSON in status file - keep checking fallbacks
      }
    }

    // 2) Fallback: check progress.json
    const progressPath = `uploads/${fileId}/progress.json`;
    const { data: progressFile, error: progressErr } = await supabase.storage
      .from(BUCKET)
      .download(progressPath);

    if (!progressErr && progressFile) {
      try {
        const text = await progressFile.text();
        const json = JSON.parse(text);
        return res.status(200).json({ fileId, ...json });
      } catch {
        // bad JSON - keep checking compressed output
      }
    }

    // 3) Fallback: if compressed.mp4 exists, report done
    const { data: compressedFile, error: compressedErr } = await supabase.storage
      .from(BUCKET)
      .download(`uploads/${fileId}/compressed.mp4`);

    if (!compressedErr && compressedFile) {
      return res.status(200).json({
        fileId,
        state: 'done',
        progress: 100,
        message: 'Compression complete'
      });
    }

    // 4) Nothing found yet
    return res.status(200).json({
      fileId,
      state: 'processing',
      progress: 0,
      message: 'No status found yet'
    });
  } catch (error) {
    console.error('progress error:', error);
    return res.status(500).json({
      error: error?.message || 'Unexpected progress error'
    });
  }
}