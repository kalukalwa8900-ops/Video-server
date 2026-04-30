const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

// folders
const uploadDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "output");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// multer setup
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

// VIDEO GENERATE ROUTE (basic dummy for now)
app.post("/generate-video", upload.array("images"), (req, res) => {
  try {
    // just simulate success
    res.json({
      success: true,
      message: "Video generation endpoint working",
      filesReceived: req.files.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// IMPORTANT FOR RAILWAY
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
