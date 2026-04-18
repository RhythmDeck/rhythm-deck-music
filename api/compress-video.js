import { NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { createClient } from '@supabase/supabase-js';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false,
    maxDuration: 300, // 5 minutes max
  },
};

export async function POST(request) {
  try {
    const { filePath } = await request.json();

    if (!filePath) {
      return NextResponse.json({ error: 'No filePath provided' }, { status: 400 });
    }

    // Get signed URL from Supabase
    const { data: signedUrlData, error } = await supabase.storage
      .from('video-uploads')
      .createSignedUrl(filePath, 3600); // 1 hour valid

    if (error) throw error;

    const inputUrl = signedUrlData.signedUrl;
    const outputPath = `/tmp/compressed-${Date.now()}.mp4`;

    // Compress using FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputUrl)
        .outputOptions('-crf 23')
        .outputOptions('-preset medium')
        .outputOptions('-c:a aac')
        .outputOptions('-b:a 128k')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const outputBuffer = require('fs').readFileSync(outputPath);

    // Optional: Clean up Supabase file after compression
    // await supabase.storage.from('video-uploads').remove([filePath]);

    return new NextResponse(outputBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed-${Date.now()}.mp4"`,
      },
    });

  } catch (error) {
    console.error('Compression error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}