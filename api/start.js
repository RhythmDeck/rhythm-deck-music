import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'video-uploads';

async function writeStatus(fileId, status) {
  const path = `uploads/${fileId}/status.json`;
  const body = JSON.stringify({ ...status, updatedAt: new Date().toISOString() });

  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: 'application/json',
  });

  if (error) throw error;
}

export async function POST(req) {
  try {
    const { fileId } = await req.json();

    if (!fileId || typeof fileId !== 'string') {
      return Response.json({ error: 'fileId is required' }, { status: 400 });
    }

    const safeFileId = fileId.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeFileId) {
      return Response.json({ error: 'invalid fileId' }, { status: 400 });
    }

    await writeStatus(safeFileId, {
      state: 'queued',
      progress: 0,
      message: 'Compression queued',
    });

    const baseUrl = process.env.APP_BASE_URL;
    const secret = process.env.INTERNAL_JOB_SECRET;

    if (!baseUrl || !secret) {
      throw new Error('APP_BASE_URL and INTERNAL_JOB_SECRET must be set');
    }

    // Fire-and-forget processing trigger
    fetch(`${baseUrl}/api/compress-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-job-secret': secret,
      },
      body: JSON.stringify({ fileId: safeFileId }),
    }).catch((e) => {
      console.error('Failed to trigger compress-video:', e);
    });

    return Response.json({ ok: true, fileId: safeFileId, state: 'queued' });
  } catch (error) {
    console.error('start error:', error);
    return Response.json(
      { error: error?.message || 'Unexpected start error' },
      { status: 500 }
    );
  }
}