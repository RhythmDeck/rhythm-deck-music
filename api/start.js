import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { maxDuration: 300 } };

export async function POST(req) {
  try {
    const { fileName, crf = 23, hevc } = await req.json();

    const { data: signedUrlData } = await supabase.storage
      .from('video-uploads')
      .createSignedUrl(fileName, 3600);

    const outputPath = `/tmp/compressed-${Date.now()}.mp4`;

    await new Promise((resolve, reject) => {
      ffmpeg(signedUrlData.signedUrl)
        .outputOptions(`-crf ${crf}`)
        .outputOptions('-preset medium')
        .outputOptions(hevc ? '-c:v libx265' : '-c:v libx264')
        .outputOptions('-c:a aac')
        .outputOptions('-b:a 128k')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const buffer = fs.readFileSync(outputPath);
    fs.unlinkSync(outputPath);

    return new Response(buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed-${Date.now()}.mp4"`
      }
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}