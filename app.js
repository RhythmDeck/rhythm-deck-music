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

app.get('/compressor', (req, res) => {
  res.sendFile(path.join(__dirname, 'compressor.html'));
});

app.post('/compress', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }

  const inputPath = req.file.path;
  const outputFilename = `compressed-${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, 'public', 'compressed', outputFilename);

  ffmpeg(inputPath)
    .videoCodec('libx264')
    .size('1280x720')
    .videoBitrate('1500k')
    .outputOptions('-crf 25')
    .audioCodec('aac')
    .audioBitrate('96k')
    .on('end', () => {
      fs.unlinkSync(inputPath);
      res.json({ downloadUrl: `/compressed/${outputFilename}` });
    })
    .on('error', (err) => {
      console.error('Compression error:', err);
      res.status(500).json({ error: 'Compression failed' });
    })
    .save(outputPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));