# Video Upload Backend (Backblaze B2 EU)

Presigned upload backend for video files, using Backblaze B2 (S3 compatible).

## Setup

1. Copy `.env.example` → `.env` and fill in credentials.
2. Run:

```bash
npm install
npm run dev
```

Your API will be available at `http://localhost:8080`.

Endpoints:
- `POST /sign-upload` — get a presigned upload URL
- `GET /list` — list uploaded videos