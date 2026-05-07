const express = require("express");
const multer = require("multer");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// FFmpeg Auto-Detection
// ================================

function detectFFmpegPath() {
  const customPath = process.env.FFMPEG_PATH;
  if (customPath && fs.existsSync(customPath)) {
    console.log(`✓ Using custom FFmpeg path: ${customPath}`);
    return customPath;
  }

  const possiblePaths = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/ffmpeg/bin/ffmpeg",
    "ffmpeg"
  ];

  for (const ffmpegPath of possiblePaths) {
    try {
      execSync(`${ffmpegPath} -version`, { stdio: "ignore" });
      console.log(`✓ Found FFmpeg at: ${ffmpegPath}`);
      return ffmpegPath;
    } catch (e) {
      continue;
    }
  }

  console.warn("⚠️  FFmpeg not found in standard locations");
  return "/usr/bin/ffmpeg";
}

function detectFFprobePath() {
  const customPath = process.env.FFPROBE_PATH;
  if (customPath && fs.existsSync(customPath)) {
    console.log(`✓ Using custom FFprobe path: ${customPath}`);
    return customPath;
  }

  const possiblePaths = [
    "/usr/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/opt/ffmpeg/bin/ffprobe",
    "ffprobe"
  ];

  for (const ffprobePath of possiblePaths) {
    try {
      execSync(`${ffprobePath} -version`, { stdio: "ignore" });
      console.log(`✓ Found FFprobe at: ${ffprobePath}`);
      return ffprobePath;
    } catch (e) {
      continue;
    }
  }

  console.warn("⚠️  FFprobe not found in standard locations");
  return "/usr/bin/ffprobe";
}

const FFMPEG_PATH = detectFFmpegPath();
const FFPROBE_PATH = detectFFprobePath();

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

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

app.use(express.static(
path.join(__dirname, "public")
));

app.use(
"/output",
express.static(
path.join(__dirname, "output")
)
);

// request logs
app.use((req, _res, next) => {

console.log(
`${req.method} ${req.originalUrl}`
);

next();

});

// ================================
// Directories
// ================================

const UPLOADS_ROOT =
path.join(__dirname, "uploads");

const OUTPUT_ROOT =
path.join(__dirname, "output");

const TEMP_ROOT =
path.join(__dirname, "temp");

[
UPLOADS_ROOT,
OUTPUT_ROOT,
TEMP_ROOT
].forEach((dir) => {

if (!fs.existsSync(dir)) {
fs.mkdirSync(dir, {
recursive: true
});
}

});

// ================================
// Helpers
// ================================

function safeName(value, fallback) {

const raw =
String(value || fallback || "")
.trim();

return raw
.replace(/[^a-zA-Z0-9_-]/g, "_")
.slice(0, 80) || fallback;

}

function extFor(file, fallback) {

const original =
file?.originalname
? path.extname(file.originalname)
: "";

if (original) {
return original.toLowerCase();
}

const mime =
(file?.mimetype || "")
.toLowerCase();

if (mime.includes("jpeg")) return ".jpg";
if (mime.includes("png")) return ".png";
if (mime.includes("webp")) return ".webp";
if (mime.includes("wav")) return ".wav";
if (mime.includes("mpeg")) return ".mp3";
if (mime.includes("mp3")) return ".mp3";
if (mime.includes("mp4")) return ".mp4";

return fallback;

}

function wrapText(text, maxW = 44) {

if (!text || !text.trim()) {
return "";
}

const words =
text.trim().split(/\s+/);

const lines = [];

let line = "";

for (const word of words) {

const candidate =
  line
    ? `${line} ${word}`
    : word;

if (candidate.length <= maxW) {

  line = candidate;

} else {

  if (line) {
    lines.push(line);
  }

  line = word.slice(0, maxW);

}

}

if (line) {
lines.push(line);
}

return lines
.slice(0, 3)
.join("\n");

}

function audioDurationSec(audioPath) {

return new Promise((resolve) => {

if (
  !audioPath ||
  !fs.existsSync(audioPath)
) {
  return resolve(0);
}

ffmpeg.ffprobe(
  audioPath,
  (err, data) => {

    if (err) {
      return resolve(0);
    }

    resolve(
      Number(
        data?.format?.duration
      ) || 0
    );

  }
);

});

}

function cleanupFiles(files = []) {

files.forEach((file) => {

try {
  fs.unlinkSync(file);
} catch (_) {}

});

}

// ================================
// Multer
// ================================

// memory upload for /panel
const panelUpload = multer({

storage: multer.memoryStorage(),

limits: {
fileSize: 150 * 1024 * 1024,
files: 4
}

});

// disk upload for legacy mode
const diskStorage = multer.diskStorage({

destination: UPLOADS_ROOT,

filename: (_req, file, cb) => {

const ext =
  path.extname(file.originalname)
    .toLowerCase() || ".jpg";

cb(
  null,
  `${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}${ext}`
);

}

});

const diskUpload = multer({

storage: diskStorage,

limits: {
fileSize: 50 * 1024 * 1024
}

});

// ================================
// Create Segment
// ================================

function createSegment({
imagePath,
audioPath,
text,
duration,
outPath,
jobId,
idx
}) {

return new Promise((resolve, reject) => {

const FONT =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const wrapped =
  wrapText(text);

const vfChain = [

  "scale=1280:720:force_original_aspect_ratio=decrease",

  "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",

  "setsar=1"

];

if (
  wrapped &&
  fs.existsSync(FONT)
) {

  const txtFile = path.join(
    TEMP_ROOT,
    `txt_${jobId}_${idx}.txt`
  );

  fs.writeFileSync(
    txtFile,
    wrapped,
    "utf8"
  );

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

    "line_spacing=6"

  ].join(":");

  vfChain.push(
    `drawtext=${drawtext}`
  );

}

const cmd = ffmpeg()
  .input(imagePath)
  .inputOptions([
    "-loop 1",
    "-framerate 25"
  ]);

if (
  audioPath &&
  fs.existsSync(audioPath)
) {
  cmd.input(audioPath);
}

cmd

  .duration(duration)

  .outputOptions([

    `-vf ${vfChain.join(",")}`,

    "-c:v libx264",

    "-pix_fmt yuv420p",

    "-r 25",

    "-preset ultrafast",

    "-movflags +faststart",

    ...(audioPath &&
    fs.existsSync(audioPath)

      ? [
          "-c:a aac",
          "-b:a 128k",
          "-shortest"
        ]

      : ["-an"])

  ])

  .output(outPath)

  .on("start", (cmd) => {
    console.log(`[seg${idx}] Starting segment encoding...`);
  })

  .on("progress", (progress) => {
    console.log(`[seg${idx}] Progress: ${Math.round(progress.percent || 0)}%`);
  })

  .on("end", () => {
    console.log(`[seg${idx}] Segment completed successfully`);
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
// Concat Segments - WebM Format
// ================================

function concatSegments(
segPaths,
outPath
) {

return new Promise((resolve, reject) => {

const listPath =
  outPath.replace(
    ".webm",
    "_list.txt"
  );

fs.writeFileSync(

  listPath,

  segPaths
    .map((p) =>
      `file '${p.replace(/'/g, "'\\''")}'`
    )
    .join("\n")

);

ffmpeg()

  .input(listPath)

  .inputOptions([
    "-f concat",
    "-safe 0"
  ])

  .outputOptions([

    "-c:v libvpx-vp9",

    "-b:v 500k",

    "-crf 30",

    "-preset ultrafast",

    "-c:a libopus",

    "-b:a 96k",

    "-movflags +faststart"

  ])

  .output(outPath)

  .on("start", (cmd) => {
    console.log(`[concat] Starting video concat (WebM format)...`);
  })

  .on("progress", (progress) => {
    console.log(`[concat] Progress: ${Math.round(progress.percent || 0)}%`);
  })

  .on("end", () => {

    try {
      fs.unlinkSync(listPath);
    } catch (_) {}

    console.log(`[concat] Video concat completed successfully`);
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

service: "scriptreel",

ffmpeg_path: FFMPEG_PATH,

ffprobe_path: FFPROBE_PATH,

video_format: "WebM (VP9/Opus)",

supported_on: "All devices including Android",

ts: new Date().toISOString()

});

});

// ================================
// PANEL ROUTE
// ================================

app.post(

"/panel",

panelUpload.fields([
{ name: "image", maxCount: 1 },
{ name: "audio", maxCount: 1 },
{ name: "narration_audio", maxCount: 1 }
]),

async (req, res) => {

try {

  const projectId = safeName(
    req.body.project_id ||
    req.body.projectId,
    "default_project"
  );

  const panelId = safeName(

    req.body.panel_id ||
    req.body.panel ||
    req.body.panel_number,

    `panel_${Date.now()}`

  );

  const index =
    parseInt(
      req.body.index ?? "0",
      10
    ) || 0;

  const narration =
    String(
      req.body.narration || ""
    );

  const requestedDuration =
    parseFloat(
      req.body.duration
    ) || 0;

  const image =
    req.files?.image?.[0];

  const audio =
    req.files?.audio?.[0] ||
    req.files?.narration_audio?.[0];

  if (!image) {

    return res.status(400).json({

      success: false,

      error: "Missing image file"

    });

  }

  const projectDir =
    path.join(
      UPLOADS_ROOT,
      projectId
    );

  const panelDir =
    path.join(
      projectDir,
      panelId
    );

  fs.mkdirSync(
    panelDir,
    { recursive: true }
  );

  const imagePath =
    path.join(
      panelDir,
      `image${extFor(image, ".png")}`
    );

  fs.writeFileSync(
    imagePath,
    image.buffer
  );

  let audioPath = null;

  if (audio) {

    audioPath = path.join(
      panelDir,
      `audio${extFor(audio, ".mp3")}`
    );

    fs.writeFileSync(
      audioPath,
      audio.buffer
    );

  }

  const probedDuration =
    audioPath
      ? await audioDurationSec(audioPath)
      : 0;

  const duration = Math.max(

    2,

    requestedDuration ||
    probedDuration ||
    4

  );

  fs.writeFileSync(

    path.join(
      panelDir,
      "metadata.json"
    ),

    JSON.stringify({

      project_id: projectId,

      panel_id: panelId,

      index,

      narration,

      duration,

      image: path.basename(imagePath),

      audio: audioPath
        ? path.basename(audioPath)
        : null,

      uploaded_at:
        new Date().toISOString()

    }, null, 2)

  );

  console.log(
    `[panel] saved ${projectId}/${panelId}`
  );

  return res.json({

    success: true,

    panel: panelId,

    panel_id: panelId,

    ref: panelId,

    project_id: projectId

  });

} catch (err) {

  console.error(
    "/panel error:",
    err
  );

  return res.status(500).json({

    success: false,

    error: err.message

  });

}

}

);

// ================================
// RENDER ROUTE
// ================================

app.post(
"/render",
(req, res, next) => {

const hasProjectId =

  req.body?.project_id ||
  req.body?.projectId;

// Use uploaded panel render mode
if (hasProjectId) {

  return renderFromProject(
    req,
    res
  ).catch(next);

}

// fallback multipart mode
return diskUpload.array(
  "images",
  30
)(req, res, () =>
  renderFromMultipart(
    req,
    res
  )
);

}
);

// ================================
// Render from uploaded panels
// ================================

async function renderFromProject(
req,
res
) {

const jobId =
crypto.randomBytes(8)
.toString("hex");

const projectId = safeName(

req.body.project_id ||
req.body.projectId,

""

);

if (!projectId) {

return res.status(400).json({

  success: false,

  error: "Missing project_id"

});

}

const projectDir =
path.join(
UPLOADS_ROOT,
projectId
);

if (!fs.existsSync(projectDir)) {

return res.status(404).json({

  success: false,

  error:
    `No uploaded panels found for project_id ${projectId}`

});

}

let orderedRefs = [];

try {

if (
  Array.isArray(req.body.panels)
) {

  orderedRefs =
    req.body.panels;

} else if (
  typeof req.body.panels === "string"
) {

  orderedRefs =
    JSON.parse(req.body.panels);

}

} catch (_) {

orderedRefs = [];

}

const readPanel = (
panelId,
fallbackIndex
) => {

const dir = path.join(

  projectDir,

  safeName(
    panelId,
    `panel_${fallbackIndex + 1}`
  )

);

const metaPath =
  path.join(
    dir,
    "metadata.json"
  );

if (
  !fs.existsSync(metaPath)
) {
  return null;
}

const meta =
  JSON.parse(
    fs.readFileSync(
      metaPath,
      "utf8"
    )
  );

return {
  ...meta,
  dir
};

};

let panels = [];

if (orderedRefs.length) {

panels = orderedRefs

  .map((p, i) =>

    readPanel(

      p.ref ||
      p.panel_id ||
      p.id ||
      p.panel,

      i

    )

  )

  .filter(Boolean);

} else {

const folders = fs

  .readdirSync(
    projectDir,
    { withFileTypes: true }
  )

  .filter((d) => d.isDirectory())

  .map((d) => d.name);

panels = folders

  .map((name, i) =>
    readPanel(name, i)
  )

  .filter(Boolean);

panels.sort((a, b) =>
  Number(a.index || 0) -
  Number(b.index || 0)
);

}

if (!panels.length) {

return res.status(400).json({

  success: false,

  error:
    "No complete panels found to render"

});

}

const segPaths = [];

try {

console.log(
  `[${jobId}] Rendering ${panels.length} panels to WebM format`
);

for (
  let i = 0;
  i < panels.length;
  i++
) {

  const p = panels[i];

  const segPath =
    path.join(
      TEMP_ROOT,
      `seg_${jobId}_${i}.webm`
    );

  await createSegment({

    imagePath:
      path.join(p.dir, p.image),

    audioPath:
      p.audio
        ? path.join(p.dir, p.audio)
        : null,

    text:
      p.narration || "",

    duration:
      Math.max(
        2,
        Number(p.duration) || 4
      ),

    outPath: segPath,

    jobId,

    idx: i

  });

  segPaths.push(segPath);

}

const finalPath =
  path.join(
    OUTPUT_ROOT,
    `${jobId}_final.webm`
  );

await concatSegments(
  segPaths,
  finalPath
);

cleanupFiles(segPaths);

const url =

  `${req.protocol}://${req.get("host")}/output/${jobId}_final.webm`;

// auto cleanup after 2 hours
setTimeout(() => {

  try {
    fs.unlinkSync(finalPath);
  } catch (_) {}

}, 2 * 60 * 60 * 1000);

console.log(
  `[${jobId}] Render complete - WebM format`
);

return res.json({

  success: true,

  jobId,

  project_id: projectId,

  panels: panels.length,

  url,

  videoUrl: url,

  video_url: url,

  download_url: url,

  format: "WebM (VP9 Video + Opus Audio)",

  device_support: "Android, Chrome, Firefox, Edge - All modern devices"

});

} catch (err) {

console.error(
  `[${jobId}] Render ERROR:`,
  err.message
);

cleanupFiles(segPaths);

return res.status(500).json({

  success: false,

  error: err.message

});

}

}

// ================================
// Legacy multipart render
// ================================

async function renderFromMultipart(
req,
res
) {

const jobId =
crypto.randomBytes(8)
.toString("hex");

const segPaths = [];

const uploadPaths =
(req.files || [])
.map((f) => f.path);

try {

if (!req.files?.length) {

  return res.status(400).json({

    success: false,

    error: "No images uploaded."

  });

}

const lines =

  String(req.body.narration || "")

    .split("\n")

    .map((l) => l.trim());

while (
  lines.length < req.files.length
) {
  lines.push("");
}

for (
  let i = 0;
  i < req.files.length;
  i++
) {

  const segPath =
    path.join(
      TEMP_ROOT,
      `seg_${jobId}_${i}.webm`
    );

  const dur = Math.max(

    3,

    Math.min(

      12,

      Math.round(

        (
          String(lines[i] || "")
            .split(/\s+/)
            .filter(Boolean)
            .length
        ) / 2.3

      ) + 1

    )

  );

  await createSegment({

    imagePath:
      req.files[i].path,

    audioPath: null,

    text:
      lines[i] || "",

    duration: dur,

    outPath: segPath,

    jobId,

    idx: i

  });

  segPaths.push(segPath);

}

const finalPath =
  path.join(
    OUTPUT_ROOT,
    `${jobId}_final.webm`
  );

await concatSegments(
  segPaths,
  finalPath
);

cleanupFiles([
  ...segPaths,
  ...uploadPaths
]);

const url =

  `${req.protocol}://${req.get("host")}/output/${jobId}_final.webm`;

setTimeout(() => {

  try {
    fs.unlinkSync(finalPath);
  } catch (_) {}

}, 2 * 60 * 60 * 1000);

return res.json({

  success: true,

  jobId,

  panels: req.files.length,

  url,

  videoUrl: url,

  video_url: url,

  download_url: url,

  format: "WebM (VP9 Video + Opus Audio)",

  device_support: "Android, Chrome, Firefox, Edge - All modern devices"

});

} catch (err) {

console.error(
  `[${jobId}] Multipart render ERROR:`,
  err.message
);

cleanupFiles([
  ...segPaths,
  ...uploadPaths
]);

return res.status(500).json({

  success: false,

  error: err.message

});

}

}

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
// START
// ================================

app.listen(
PORT,
"0.0.0.0",
() => {

console.log(
  `ScriptReel running on port ${PORT}`
);

console.log(
  `Video format: WebM (VP9/Opus) - Perfect for Android & Web`
);

}
);
