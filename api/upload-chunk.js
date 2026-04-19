import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: false } };

export async function POST(req) {
  try {
    const form = await req.formData();
    const chunk = form.get('chunk');
    const fileId = form.get('fileId');
    const index = form.get('index');

    if (!chunk || !fileId) {
      return Response.json({ error: 'Missing chunk or fileId' }, { status: 400 });
    }

    const fileName = `${fileId}-chunk-${index}`;

    console.log(`Uploading chunk: ${fileName}`);

    const { error } = await supabase.storage
      .from('video-uploads')
      .upload(fileName, chunk, { upsert: true });

    if (error) {
      console.error('Supabase upload error:', error);
      throw error;
    }

    console.log(`Successfully uploaded chunk: ${fileName}`);

    return Response.json({ success: true, fileName });
  } catch (error) {
    console.error('Upload chunk error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}