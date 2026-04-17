import { NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export const config = {
  api: {
    bodyParser: false,        // Important for file uploads
    maxDuration: 300,         // 5 minutes max (upgrade plan if needed)
  },
};

export async function POST(req) {
  try {
    const formData = await req.formData();
    const videoFile = formData.get('video');
    const crf = parseInt(formData.get('crf')) || 23;

    if (!videoFile) {
      return NextResponse.json({ error: 'No video uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await videoFile.arrayBuffer());
    const inputPath = `/tmp/input-${Date.now()}.mp4`;
    const outputPath = `/tmp/output-${Date.now()}.mp4`;

    // Write file to temp folder
    await require('fs').promises.writeFile(inputPath, buffer);

    // Run compression
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([`-crf ${crf}`, '-preset medium', '-c:a aac', '-b:a 128k'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const outputBuffer = await require('fs').promises.readFile(outputPath);

    // Clean up temp files
    require('fs').unlinkSync(inputPath);
    require('fs').unlinkSync(outputPath);

    return new NextResponse(outputBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="compressed.mp4"',
      },
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}// JavaScript Document