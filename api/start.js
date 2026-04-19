import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';

ffmpeg.setFfmpegPath(ffmpegStatic);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { maxDuration: 300 } };

export async function POST(req) {
  try {
    const { fileId, crf = 23, hevc } = await req.json();

    console.log(`[START] Received request for fileId: ${fileId}`);

    // List all files in the bucket to see what actually exists
    const { data: allFiles, error: listAllError } = await supabase.storage
      .from('video-uploads')
      .list('');

    console.log(`[START] Total files in bucket: ${allFiles ? allFiles.length : 0}`);

    // List chunks for this fileId
    const { data: chunks, error: listError } = await supabase.storage
      .from('video-uploads')
      .list('', { search: fileId });

    console.log(`[START] Chunks found for ${fileId}: ${chunks ? chunks.length : 0}`);

    if (listError) throw listError;
    if (!chunks || chunks.length === 0) {
      throw new Error(`No chunks found for fileId: ${fileId}. Bucket has ${allFiles ? allFiles.length : 0} files total.`);
    }

    // Sort chunks by index
    const sortedChunks = chunks.sort((a, b) => {
      const idxA = parseInt(a.name.split('-chunk-')[1] || 0);
      const idxB = parseInt(b.name.split('-chunk-')[1] || 0);
      return idxA - idxB;
    });

    console.log(`[START] Sorted chunks: ${sortedChunks.map(c => c.name).join(', ')}`);

    // Merge chunks
    const mergedPath = `/tmp/merged-${fileId}.mp4`;
    const writeStream = fs.createWriteStream(mergedPath);

    for (const chunk of sortedChunks) {
      const { data: chunkData, error: downloadError } = await supabase.storage
        .from('video-uploads')
        .download(chunk.name);

      if (downloadError) throw downloadError;

      writeStream.write(chunkData);
      console.log(`[START] Merged chunk: ${chunk.name}`);
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