import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

/** CORS: allow your site(s) */
const allowed = new Set([
  "https://www.coopscoops.uk",
  "https://coopscoops.uk",
  "http://localhost:5173"
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET","POST","PUT","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(helmet());
app.use(morgan("dev"));

/** Raw ONLY for proxy route; JSON for the rest */
app.post("/upload-proxy", express.raw({ type: "*/*", limit: "5gb" }), async (req, res) => {
  try {
    const filename = (req.query.filename || `clip-${Date.now()}.mp4`).toString();
    const contentType = req.headers["content-type"] || "application/octet-stream";

    // Sign a PUT to B2
    const putCmd = new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: filename,
      ContentType: contentType
    });
    const s3ClientForSign = new S3Client({
      region: process.env.B2_REGION,
      endpoint: process.env.B2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY || process.env.B2_KEY_SECRET
      }
    });
    const uploadUrl = await getSignedUrl(s3ClientForSign, putCmd, { expiresIn: 3600 });

    // Stream file to B2 (no browser→B2 CORS)
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: req.body
    });
    if (!put.ok) {
      const txt = await put.text();
      return res.status(502).json({ error: "b2 put failed", status: put.status, body: txt });
    }
    return res.json({ ok: true, key: filename });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proxy error" });
  }
});

/** JSON parser for the rest */
app.use(express.json());

/** S3 client for normal ops */
const s3 = new S3Client({
  region: process.env.B2_REGION,
  endpoint: process.env.B2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY || process.env.B2_KEY_SECRET
  }
});

/** Health */
app.get("/health", (req, res) => res.json({ ok: true }));

/** Sign direct upload (kept for compatibility) */
app.post("/sign-upload", async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename) return res.status(400).json({ error: "filename required" });
    const cmd = new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: filename,
      ContentType: contentType || "application/octet-stream"
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    res.json({ uploadUrl: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "sign failed" });
  }
});

/** List for gallery */
app.get("/list", async (req, res) => {
  try {
    const out = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.B2_BUCKET,
      MaxKeys: 1000
    }));
    const base = process.env.B2_PUBLIC_BASE_URL || "";
    const items = (out.Contents || []).map(obj => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      publicUrl: base ? `${base}/${encodeURIComponent(obj.Key)}` : undefined
    })).sort((a,b)=> new Date(b.lastModified) - new Date(a.lastModified));
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "list failed" });
  }
});

app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
