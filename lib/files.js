// Uploaded photos: saved to public/uploads/ (local / single server) or to Vercel Blob (on Vercel,
// when a Blob store is connected). Returns the URL to store with the product, post or tile.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USE_BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!USE_BLOB && !process.env.VERCEL) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const newName = ext => `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
const isBlobUrl = url => /^https:\/\/[a-z0-9-]+\.(public\.)?blob\.vercel-storage\.com\//i.test(String(url || ''));

async function save(buffer, ext, contentType) {
  const name = newName(ext);
  if (USE_BLOB) {
    const { put } = require('@vercel/blob');
    const blob = await put(`uploads/${name}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.VERCEL) {
    throw Object.assign(new Error('Photo uploads need a Vercel Blob store connected to this project.'), { status: 500 });
  }
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

// Best-effort delete of a photo this app uploaded (never throws)
function remove(url) {
  if (!url) return;
  if (url.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
  } else if (USE_BLOB && isBlobUrl(url)) {
    const { del } = require('@vercel/blob');
    del(url).catch(() => {});
  }
}

module.exports = { USE_BLOB, UPLOAD_DIR, save, remove, isBlobUrl };
