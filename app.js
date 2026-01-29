const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());

app.get('/compressor', (req, res) => {
  res.sendFile(path.join(__dirname, 'compressor.html'));
});

app.post('/compress', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }

  const inputPath = req.file.path;
  const originalSize = req.file.size / (1024 * 1024); // MB
  const compressionType = req.body.type || 'basic'; // 'basic' or 'strong'
  const outputFilename = `compressed-${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, 'public', 'compressed', outputFilename);

  let crf = 23; // Basic (higher quality)
  let bitrate = '2000k';
  let resolution = '1280x720';
  if (compressionType === 'strong') {
    crf = 28; // Strong (smaller size)
    bitrate = '1000k';
    resolution = '854x480'; // Lower res for stronger compression
  }

  ffmpeg(inputPath)
    .videoCodec('libx264')
    .size(resolution)
    .videoBitrate(bitrate)
    .outputOptions(`-crf ${crf}`)
    .audioCodec('aac')
    .audioBitrate('96k')
    .on('end', () => {
      fs.stat(outputPath, (err, stats) => {
        if (err) return res.status(500).json({ error: 'Failed to get size' });
        const compressedSize = stats.size / (1024 * 1024); // MB
        fs.unlinkSync(inputPath); // Clean up
        res.json({ downloadUrl: `/compressed/${outputFilename}`, originalSize: originalSize.toFixed(2), compressedSize: compressedSize.toFixed(2) });
      });
    })
    .on('error', (err) => {
      res.status(500).json({ error: 'Compression failed: ' + err.message });
    })
    .save(outputPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));