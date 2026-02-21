from flask import Flask, request, jsonify
import librosa
import numpy as np
import tempfile
import os

app = Flask(__name__)

@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    with tempfile.NamedTemporaryFile(delete=False) as temp:
        file.save(temp.name)
        y, sr = librosa.load(temp.name)
        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)

    os.unlink(temp.name)

    notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    top_notes = np.argsort(chroma_mean)[-3:]
    chords = [notes[i] for i in top_notes]

    return jsonify({"estimated_chords": chords})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
