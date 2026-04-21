import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'video-uploads';

export async function GET(req) {
  try {
    const fileIdRaw = req.nextUrl.searchParams.get('fileId');
    if (!fileIdRaw) {
      return Response.json({ error: 'fileId is required' }, { status: 400 });
    }

    const fileId = fileIdRaw.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!fileId) {
      return Response.json({ error: 'invalid fileId' }, { status: 400 });
    }

    const statusPath = `uploads/${fileId}/status.json`;

    const { data: statusFile, error: statusErr } = await supabase.storage
      .from(BUCKET)
      .download(statusPath);

    if (!statusErr && statusFile) {
      const text = await statusFile.text();
      const json = JSON.parse(text);
      return Response.json({ fileId, ...json });
    }

    // Fallback: if compressed file exists, report done
    const { data: compressedFile, error: compressedErr } = await supabase.storage
      .from(BUCKET)
      .download(`uploads/${fileId}/compressed.mp4`);

    if (!compressedErr && compressedFile) {
      return Response.json({
        fileId,
        state: 'done',
        progress: 100,
        message: 'Compression complete',
      });
    }

    return Response.json({
      fileId,
      state: 'unknown',
      progress: 0,
      message: 'No status found yet',
    });
  } catch (error) {
    console.error('progress error:', error);
    return Response.json(
      { error: error?.message || 'Unexpected progress error' },
      { status: 500 }
    );
  }
}