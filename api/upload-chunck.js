import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: false } };

export async function POST(req) {
  const form = await req.formData();
  const chunk = form.get('chunk');
  const fileId = form.get('fileId');
  const index = form.get('index');

  const fileName = `${fileId}-chunk-${index}.bin`;

  const { error } = await supabase.storage
    .from('video-uploads')
    .upload(fileName, chunk, { upsert: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}// JavaScript Document