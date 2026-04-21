import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  try {
    const form = await req.formData();

    const chunk = form.get('chunk');
    const fileIdRaw = form.get('fileId');
    const indexRaw = form.get('index');

    if (!(chunk instanceof Blob)) {
      return Response.json({ error: 'chunk must be a file/blob' }, { status: 400 });
    }

    if (!fileIdRaw || typeof fileIdRaw !== 'string') {
      return Response.json({ error: 'fileId is required' }, { status: 400 });
    }

    const fileId = fileIdRaw.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!fileId) {
      return Response.json({ error: 'invalid fileId' }, { status: 400 });
    }

    if (indexRaw === null || indexRaw === undefined) {
      return Response.json({ error: 'index is required' }, { status: 400 });
    }

    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0) {
      return Response.json({ error: 'index must be a non-negative integer' }, { status: 400 });
    }

    const objectPath = `uploads/${fileId}/chunks/${String(index).padStart(6, '0')}.part`;

    const { error } = await supabase.storage
      .from('video-uploads')
      .upload(objectPath, chunk, {
        upsert: true,
        contentType: 'application/octet-stream',
      });

    if (error) throw error;

    return Response.json({ ok: true, fileId, index, path: objectPath });
  } catch (error) {
    console.error('upload-chunck error:', error);
    return Response.json(
      { error: error?.message || 'Unexpected upload error' },
      { status: 500 }
    );
  }
}