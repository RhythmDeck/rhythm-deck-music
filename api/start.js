import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { maxDuration: 300 } };

export async function POST(req) {
  const { fileId, crf, hevc, width, height, output } = await req.json();

  // Get signed URL from Supabase
  const { data } = await supabase.storage.from('video-uploads').createSignedUrl(`${fileId}-full`, 3600);

  const outputPath = `/tmp/compressed-${Date.now()}.mp4`;

  await new Promise((resolve, reject) => {
    ffmpeg(data.signedUrl)
      .outputOptions(`-crf ${crf}`)
      .outputOptions('-preset medium')
      .outputOptions(hevc ? '-c:v libx265' : '-c:v libx264')
      .outputOptions('-c:a aac')
      .outputOptions('-b:a 128k')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });

  const buffer = require('fs').readFileSync(outputPath);

  return new Response(buffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="compressed.mp4"'
    }
  });
}// JavaScript Document