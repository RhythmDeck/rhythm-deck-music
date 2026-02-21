import express from "express";
import multer from "multer";
import cors from "cors";

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
  res.json({ message: "Rhythm Deck Audio Engine Running" });
});

app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileSize = req.file.buffer.length;

    // For now we are just confirming file receipt.
    // Next step we will plug in Spotify Basic Pitch.

    res.json({
      message: "Audio received for processing",
      filename: req.file.originalname,
      size_in_bytes: fileSize
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Processing failed" });
  }
});

app.listen(port, () => {
  console.log(`Audio Engine running on port ${port}`);
});
