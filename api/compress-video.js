import { createClient } from '@supabase/supabase-js';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'video-uploads';

async function writeStatus(fileId, status) {
  const statusPath = `uploads/${fileId}/status.json`;
  const body = JSON.stringify({ ...status, updatedAt: new Date().toISOString() });

  const { error } = await supabase.storage.from(BUCKET).upload(statusPath, body, {
    upsert: true,
    contentType: 'application/json',
  });
  if (error) throw error;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
    });
  });
}

export async function POST(req) {
  const secret = req.headers.get('x-job-secret');
  if (!process.env.INTERNAL_JOB_SECRET || secret !== process.env.INTERNAL_JOB_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let tempDir = null;

  try {
    const { fileId } = await req.json();

    if (!fileId || typeof fileId !== 'string') {
      return Response.json({ error: 'fileId is required' }, { status: 400 });
    }

    const safeFileId = fileId.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeFileId) {
      return Response.json({ error: 'invalid fileId' }, { status: 400 });
    }

    if (!ffmpegPath) throw new Error('ffmpeg binary not found (ffmpeg-static)');

    await writeStatus(safeFileId, {
      state: 'processing',
      progress: 10,
      message: 'Collecting chunks',
    });

    const chunksPrefix = `uploads/${safeFileId}/chunks`;
    const { data: chunkObjects, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(chunksPrefix, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });

    if (listError) throw listError;
    if (!chunkObjects || chunkObjects.length === 0) {
      throw new Error('No chunks found for this fileId');
    }

    const chunkNames = chunkObjects
      .map((o) => o.name)
      .filter(Boolean)
      .sort();

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-${safeFileId}-`));
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'compressed.mp4');

    await writeStatus(safeFileId, {
      state: 'processing',
      progress: 25,
      message: 'Downloading chunks',
      totalChunks: chunkNames.length,
    });

    const buffers = [];
    for (const name of chunkNames) {
      const chunkPath = `${chunksPrefix}/${name}`;
      const { data, error } = await supabase.storage.from(BUCKET).download(chunkPath);
      if (error) throw error;

      const arr = await data.arrayBuffer();
      buffers.push(Buffer.from(arr));
    }

    const merged = Buffer.concat(buffers);
    await fs.writeFile(inputPath, merged);

    await writeStatus(safeFileId, {
      state: 'processing',
      progress: 60,
      message: 'Running compression',
    });

    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-vcodec',
      'libx264',
      '-crf',
      '28',
      '-preset',
      'veryfast',
      '-acodec',
      'aac',
      '-b:a',
      '128k',
      outputPath,
    ]);

    await writeStatus(safeFileId, {
      state: 'processing',
      progress: 85,
      message: 'Uploading compressed video',
    });

    const outBuffer = await fs.readFile(outputPath);
    const outputObjectPath = `uploads/${safeFileId}/compressed.mp4`;

    const { error: uploadError } = await supabase.storage

      .from(BUCKET)
      .upload(outputObjectPath, outBuffer, {
        upsert: true,
        contentType: 'video/mp4',
      });

    if (uploadError) throw uploadError;

    await writeStatus(safeFileId, {
      state: 'done',
      progress: 100,
      message: 'Compression complete',
      outputPath: outputObjectPath,
    });

    return Response.json({ ok: true, fileId: safeFileId, outputPath: outputObjectPath });
  } catch (error) {
    console.error('compress-video error:', error);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.fileId) {
        const safeFileId = String(body.fileId).replace(/[^a-zA-Z0-9-_]/g, '');
        if (safeFileId) {
          await writeStatus(safeFileId, {
            state: 'error',
            progress: 100,
            message: error?.message || 'Compression failed',
          });
        }
      }
    } catch (_) {}

    return Response.json(
      { error: error?.message || 'Unexpected compression error' },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}