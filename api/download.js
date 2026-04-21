import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const candidatePaths = [
      `uploads/${fileId}/compressed.mp4`,
      `uploads/${fileId}/output/compressed.mp4`,
      `${fileId}-compressed.mp4`,
    ];

    let fileData = null;
    let foundPath = null;

    for (const p of candidatePaths) {
      const { data, error } = await supabase.storage.from('video-uploads').download(p);
      if (!error && data) {
        fileData = data;
        foundPath = p;
        break;
      }
    }

    if (!fileData) {
      return Response.json(
        { error: 'Compressed file not found for this fileId' },
        { status: 404 }
      );
    }

    return new Response(fileData, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${fileId}-compressed.mp4"`,
        'Cache-Control': 'no-store',
        'X-Source-Path': foundPath,
      },
    });
  } catch (error) {
    console.error('download error:', error);
    return Response.json(
      { error: error?.message || 'Unexpected download error' },
      { status: 500 }
    );
  }
}