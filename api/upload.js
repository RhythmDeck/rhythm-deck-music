export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
    });

    req.on("end", () => {
      res.status(200).json({
        message: "File received successfully",
        size_in_bytes: size,
      });
    });

  } catch (error) {
    res.status(500).json({ error: "Upload failed" });
  }
}
