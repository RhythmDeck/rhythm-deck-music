import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { maxDuration: 300 } };

export async function POST(req) {
  try {
    const { fileId, crf = 23, hevc, width, height, output } = await req.json();

    // List all chunks for this fileId
    const { data: chunks } = await supabase.storage
      .from('video-uploads')
      .list('', { search: fileId });

    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks found for this file');
    }

    // Create a merged input file in /tmp
    const mergedPath = `/tmp/merged-${fileId}.mp4`;
    const writeStream = fs.createWriteStream(mergedPath);

    for (const chunk of chunks.sort((a, b) => a.name.localeCompare(b.name))) {
      const { data: chunkData } = await supabase.storage
        .from('video-uploads')
        .download(chunk.name);

      writeStream.write(chunkData);
    }

    writeStream.end();

    await new Promise((resolve) => writeStream.on('finish', resolve));

    const outputPath = `/tmp/compressed-${Date.now()}.mp4`;

    await new Promise((resolve, reject) => {
      ffmpeg(mergedPath)
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

    // Clean up temp files
    fs.unlinkSync(mergedPath);
    fs.unlinkSync(outputPath);

    return new Response(buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed-${Date.now()}.mp4"`
      }
    });
  } catch (error) {
    console.error('Compression error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
