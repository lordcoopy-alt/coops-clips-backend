import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  FRONTEND_ORIGIN,
  PORT = 8080,
} = process.env;

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.warn('[WARN] Missing one or more required S3 env vars. Fill .env before running.');
}

const s3 = new S3Client({
  region: 'eu-central-003',
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: FRONTEND_ORIGIN ? FRONTEND_ORIGIN.split(',').map(s => s.trim()) : '*',
  credentials: false,
}));
app.use(morgan('tiny'));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/sign-upload', async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename required' });

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 15 * 60 });

    return res.json({ uploadUrl, key, expiresIn: 900 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'failed_to_sign', details: String(err) });
  }
});

app.get('/list', async (req, res) => {
  try {
    const Prefix = req.query.prefix || 'uploads/';
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix,
      MaxKeys: 1000,
    });
    const out = await s3.send(command);
    const items = (out.Contents || []).map(obj => {
      const key = obj.Key;
      const size = obj.Size;
      const lastModified = obj.LastModified;
      const publicUrl = R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}` : null;
      return { key, size, lastModified, publicUrl };
    });
    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'failed_to_list', details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});