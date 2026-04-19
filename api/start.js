import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { maxDuration: 300 } };

export async function POST(req) {
  try {
    const { fileId, crf = 23, hevc, width, height, output } = await req.json();

    // List all chunks for this fileId
    const { data: chunks, error: listError } = await supabase.storage
      .from('video-uploads')
      .list('', { search: fileId });

    if (listError) throw listError;
    if (!chunks || chunks.length === 0) throw new Error('No chunks found for this fileId');

    // Sort chunks by index
    const sortedChunks = chunks.sort((a, b) => {
      const indexA = parseInt(a.name.split('-chunk-')[1] || 0);
      const indexB = parseInt(b.name.split('-chunk-')[1] || 0);
      return indexA - indexB;
    });

    // Create merged file
    const mergedPath = `/tmp/merged-${fileId}.mp4`;
    const writeStream = fs.createWriteStream(mergedPath);

    for (const chunk of sortedChunks) {
      const { data: chunkData, error: downloadError } = await supabase.storage
        .from('video-uploads')
        .download(chunk.name);

      if (downloadError) throw downloadError;

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

    // Clean up
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