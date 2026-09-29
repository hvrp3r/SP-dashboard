import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { handleImageUpload } from '../middleware/upload.js';

const router = Router();

// Upload générique d'image par le MSP : renvoie un chemin relatif à stocker tel
// quel dans n'importe quel champ image_url (caisses, gains, cosmétiques…), en
// alternative à un lien externe.
router.post('/image', requireAuth, requireAdmin, handleImageUpload, (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Aucun fichier reçu' });
    return;
  }
  res.status(201).json({ url: `/uploads/images/${req.file.filename}` });
});

export default router;
