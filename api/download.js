import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function GET(req) {
  const fileId = req.nextUrl.searchParams.get('fileId');
  const { data } = await supabase.storage.from('video-uploads').download(`${fileId}-compressed.mp4`);
  return new Response(data, {
    headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="compressed.mp4"' }
  });
}// JavaScript Document