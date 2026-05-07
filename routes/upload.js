const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const uploadsDir = path.join(__dirname, '../uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(webm|ogg|mp4|mpeg)/;
  if (allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images, videos, and audio are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// POST /api/upload
router.post('/', verifyToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    console.error('No file in request');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const fileType = req.file.mimetype.startsWith('image/')
      ? 'image'
      : req.file.mimetype.startsWith('audio/')
      ? 'audio'
      : 'video';

    // Get the full backend URL from environment or construct it
    const protocol = req.protocol || 'https';
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

    console.log(`File uploaded: ${req.file.filename} (${fileType}) at ${fileUrl}`);
    res.json({ fileUrl, fileType, originalName: req.file.originalname });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error:', error.message);
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }
  if (error) {
    console.error('Upload error:', error.message);
    return res.status(400).json({ error: error.message });
  }
  next();
});

module.exports = router;
