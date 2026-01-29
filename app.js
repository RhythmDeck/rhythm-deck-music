const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const os = require('os');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const tempDir = os.tmpdir();
const upload = multer({ dest: tempDir });

app.use(express.static(__dirname));

app.get('/compressor', (req, res) => {
  res.sendFile(path.join(__dirname, 'compressor.html'));
});

app.post('/compress', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }

  const inputPath = req.file.path;
  const originalSize = (req.file.size / (1024 * 1024)).toFixed(2);
  const targetSize = parseFloat(req.body.targetSize) || 25; // Default 25MB
  let resolution = req.body.resolution || '1280x720';

  const outputFilename = `compressed-${Date.now()}.mp4`;
  const outputPath = path.join(tempDir, outputFilename);

  let crf = 23; // Starting quality
  let bitrate = '2000k';

  // Adjust based on target size ratio
  const sizeRatio = targetSize / originalSize;
  if (sizeRatio < 0.5) {
    crf = 28; // Lower quality for small target
    bitrate = '1000k';
  } else if (sizeRatio < 0.75) {
    crf = 25;
    bitrate = '1500k';
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
        let compressedSize = (stats.size / (1024 * 1024)).toFixed(2);

        // If still > target, re-compress with higher CRF (up to 2 tries)
        if (compressedSize > targetSize && crf < 28) {
          crf += 3; // Increase compression
          ffmpeg(inputPath)
            .videoCodec('libx264')
            .size(resolution)
            .videoBitrate(bitrate)
            .outputOptions(`-crf ${crf}`)
            .audioCodec('aac')
            .audioBitrate('96k')
            .save(outputPath)
            .on('end', () => {
              fs.stat(outputPath, (err, stats) => {
                compressedSize = (stats.size / (1024 * 1024)).toFixed(2);
                sendResponse();
              });
            });
        } else {
          sendResponse();
        }

        function sendResponse() {
          fs.unlinkSync(inputPath);
          res.json({ downloadUrl: `/download/${outputFilename}`, originalSize, compressedSize });
        }
      });
    })
    .on('error', (err) => {
      fs.unlinkSync(inputPath);
      res.status(500).json({ error: 'Compression failed: ' + err.message });
    })
    .save(outputPath);
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(os.tmpdir(), req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, req.params.filename, (err) => {
      if (err) res.status(500).send('Error downloading file');
      setTimeout(() => fs.unlinkSync(filePath), 60000); // Clean up after 1 min
    });
  } else {
    res.status(404).send('File not found');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));