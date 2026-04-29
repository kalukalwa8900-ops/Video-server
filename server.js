const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

app.post("/render", upload.array("images"), (req, res) => {
  const files = req.files;

  let list = "";
  files.forEach((file) => {
    list += `file '${file.path}'\n`;
    list += `duration 2\n`;
  });

  fs.writeFileSync("list.txt", list);

  exec(
    "ffmpeg -f concat -safe 0 -i list.txt -vsync vfr -pix_fmt yuv420p output.mp4",
    (err) => {
      if (err) return res.status(500).send("Error");

      res.download("output.mp4");
    }
  );
});

app.get("/", (req, res) => {
  res.send("Working ✅");
});

app.listen(3000, () => console.log("Server running"));
