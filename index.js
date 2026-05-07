const express = require("express");
const multer = require("multer");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// FFmpeg paths
// ================================

ffmpeg.setFfmpegPath(
process.env.FFMPEG_PATH || "/usr/bin/ffmpeg"
);

ffmpeg.setFfprobePath(
process.env.FFPROBE_PATH || "/usr/bin/ffprobe"
);

// ================================
// Middleware
// ================================

app.use(cors());

app.use(express.json({
limit: "50mb"
}));

app.use(express.urlencoded({
extended: true,
limit: "50mb"
}));

app.use(express.static(path.join(__dirname, "public")));

app.use(
"/output",
express.static(path.join(__dirname, "output"))
);

// ================================
// Ensure folders exist
// ================================

["uploads", "output", "temp"].forEach((dir) => {

const p = path.join(__dirname, dir);

if (!fs.existsSync(p)) {
fs.mkdirSync(p, { recursive: true });
}

});

// ================================
// Multer
// ================================

const storage = multer.diskStorage({

destination: path.join(__dirname, "uploads"),

filename: (_req, file, cb) => {

const ext =
  path.extname(file.originalname).toLowerCase() || ".jpg";

cb(
  null,
  `${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}${ext}`
);

},

});

const upload = multer({

storage,

limits: {
fileSize: 25 * 1024 * 1024,
},

});

// ================================
// Helpers
// ================================

function calcDuration(text) {

const words = (text || "")
.trim()
.split(/\s+/)
.filter(Boolean).length;

return Math.max(
3,
Math.min(12, Math.round(words / 2.3) + 1)
);
}

function wrapText(text, maxW = 44) {

if (!text || !text.trim()) return "";

const words = text.trim().split(/\s+/);

const lines = [];

let line = "";

for (const w of words) {

const candidate = line
  ? `${line} ${w}`
  : w;

if (candidate.length <= maxW) {

  line = candidate;

} else {

  if (line) lines.push(line);

  line = w.slice(0, maxW);
}

}

if (line) lines.push(line);

return lines.slice(0, 3).join("\n");
}

function cleanup(jobId, segPaths, uploadPaths) {

[...segPaths, ...uploadPaths].forEach((f) => {

try {
  fs.unlinkSync(f);
} catch (_) {}

});

try {

fs.readdirSync(path.join(__dirname, "temp"))
  .filter((f) => f.includes(jobId))
  .forEach((f) =>
    fs.unlinkSync(path.join(__dirname, "temp", f))
  );

} catch (_) {}
}

// ================================
// Create Segment
// ================================

function createSegment(
imagePath,
text,
duration,
outPath,
jobId,
idx
) {

return new Promise((resolve, reject) => {

const FONT =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const wrapped = wrapText(text);

let vfChain = [

  "scale=1280:720:force_original_aspect_ratio=decrease",

  "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",

  "setsar=1",

];

if (wrapped) {

  const txtFile = path.join(
    __dirname,
    "temp",
    `txt_${jobId}_${idx}.txt`
  );

  fs.writeFileSync(txtFile, wrapped, "utf8");

  const drawtext = [

    `fontfile=${FONT}`,

    `textfile=${txtFile}`,

    "fontcolor=white",

    "fontsize=32",

    "x=(w-text_w)/2",

    "y=h-text_h-36",

    "box=1",

    "boxcolor=black@0.60",

    "boxborderw=14",

    "line_spacing=6",

  ].join(":");

  vfChain.push(`drawtext=${drawtext}`);
}

ffmpeg(imagePath)

  .inputOptions(["-loop 1"])

  .duration(duration)

  .outputOptions([

    `-vf ${vfChain.join(",")}`,

    "-c:v libx264",

    "-pix_fmt yuv420p",

    "-r 25",

    "-preset fast",

    "-movflags +faststart",

  ])

  .output(outPath)

  .on("start", (cmd) => {
    console.log(`[seg${idx}] ${cmd}`);
  })

  .on("end", () => {
    resolve(outPath);
  })

  .on("error", (err) => {

    console.error(
      `[seg${idx}] ERROR:`,
      err.message
    );

    reject(err);
  })

  .run();

});
}

// ================================
// Concat Segments
// ================================

function concatSegments(segPaths, outPath) {

return new Promise((resolve, reject) => {

const listPath =
  outPath.replace(".mp4", "_list.txt");

fs.writeFileSync(

  listPath,

  segPaths
    .map((p) => `file '${p.replace(/\\/g, "/")}'`)
    .join("\n")

);

ffmpeg()

  .input(listPath)

  .inputOptions([
    "-f concat",
    "-safe 0",
  ])

  .outputOptions([
    "-c copy",
    "-movflags +faststart",
  ])

  .output(outPath)

  .on("end", () => {

    try {
      fs.unlinkSync(listPath);
    } catch (_) {}

    resolve(outPath);

  })

  .on("error", (err) => {

    console.error(
      "Concat ERROR:",
      err.message
    );

    reject(err);

  })

  .run();

});
}

// ================================
// HEALTH
// ================================

app.get("/health", (_req, res) => {

res.json({
status: "ok",
ts: new Date().toISOString()
});

});

// ================================
// PANEL ROUTE
// ================================

app.post(
"/panel",
upload.fields([
{ name: "image", maxCount: 1 },
{ name: "audio", maxCount: 1 },
]),
async (req, res) => {

try {

  if (!req.files?.image?.[0]) {

    return res.status(400).json({
      success: false,
      error: "Missing image"
    });

  }

  const panelId =
    req.body.panel_id ||
    req.body.panel ||
    `panel_${Date.now()}`;

  return res.json({

    success: true,

    panel: panelId,

    panel_id: panelId,

    ref: panelId

  });

} catch (err) {

  console.error("/panel error:", err);

  res.status(500).json({

    success: false,

    error: err.message

  });

}

}
);

// ================================
// RENDER ROUTE
// ================================

app.post("/render", async (req, res) => {

try {

return res.json({

  success: true,

  message: "Render route working",

  received: req.body

});

} catch (err) {

console.error("/render error:", err);

res.status(500).json({

  success: false,

  error: err.message

});

}

});

// ================================
// MAIN VIDEO GENERATOR
// ================================

app.post(
"/generate-video",
upload.array("images", 20),
async (req, res) => {

const jobId =
  crypto.randomBytes(8).toString("hex");

const segPaths = [];

const uploadPaths =
  (req.files || []).map((f) => f.path);

try {

  if (!req.files?.length) {

    return res.status(400).json({
      error: "No images uploaded."
    });

  }

  if (!req.body.narration) {

    return res.status(400).json({
      error: "Narration is required."
    });

  }

  const lines =
    req.body.narration
      .split("\n")
      .map((l) => l.trim());

  while (lines.length < req.files.length) {
    lines.push("");
  }

  console.log(
    `[${jobId}] ${req.files.length} panel(s)`
  );

  for (let i = 0; i < req.files.length; i++) {

    const duration =
      calcDuration(lines[i]);

    const segPath = path.join(
      __dirname,
      "temp",
      `seg_${jobId}_${i}.mp4`
    );

    await createSegment(
      req.files[i].path,
      lines[i],
      duration,
      segPath,
      jobId,
      i
    );

    segPaths.push(segPath);

  }

  const finalPath = path.join(
    __dirname,
    "output",
    `${jobId}_final.mp4`
  );

  await concatSegments(
    segPaths,
    finalPath
  );

  cleanup(
    jobId,
    segPaths,
    uploadPaths
  );

  res.json({

    success: true,

    videoUrl: `/output/${jobId}_final.mp4`,

    jobId,

    panels: req.files.length,

  });

  setTimeout(() => {

    try {
      fs.unlinkSync(finalPath);
    } catch (_) {}

  }, 2 * 60 * 60 * 1000);

} catch (err) {

  console.error(
    `[${jobId}] ERROR`,
    err.message
  );

  cleanup(
    jobId,
    segPaths,
    uploadPaths
  );

  res.status(500).json({

    error: "Video generation failed.",

    details: err.message

  });

}

}
);

// ================================
// 404
// ================================

app.use((req, res) => {

res.status(404).json({

success: false,

error: "Route not found",

path: req.originalUrl

});

});

// ================================
// START SERVER
// ================================

app.listen(PORT, "0.0.0.0", () => {

console.log(
"ScriptReel running on port ${PORT}"
);

});
