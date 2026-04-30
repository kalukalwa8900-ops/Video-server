# video-server

Node + Express + FFmpeg backend that turns images + narration into an MP4.

## Endpoints

- `GET /` → health check
- `POST /generate-video` (multipart/form-data)
  - `images`: image files (one per panel, up to 50)
  - `narration`: text, one line per image (controls duration: ~3–8s based on word count)
  - returns `{ "videoUrl": "https://your-host/output/final-xxxx.mp4" }`

## Local run

```
npm install
# requires ffmpeg in PATH
npm start
```

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. Create a new Railway project → "Deploy from GitHub repo".
3. Railway will detect the `Dockerfile` and build it (FFmpeg comes baked in).
4. After deploy, copy the public URL (e.g. `https://video-server-production.up.railway.app`).
5. Paste that URL into the frontend app's "Server URL" field.

## Deploy with Docker anywhere

```
docker build -t video-server .
docker run -p 3000:3000 video-server
```

## Notes

- CORS is enabled for all origins.
- Output files are served from `/output/<filename>.mp4`.
- For production, consider mounting a volume on `/app/output` and adding cleanup.
