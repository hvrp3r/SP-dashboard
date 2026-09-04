import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as cosmeticsController from '../controllers/cosmetics.controller.js';

const router = Router();

router.get('/catalog', requireAuth, cosmeticsController.listCatalog);
router.get('/rarity-weights', requireAuth, cosmeticsController.getRarityWeights);
router.get('/me', requireAuth, cosmeticsController.getMine);
router.get('/user/:id', requireAuth, cosmeticsController.getForUser);
router.post('/equip', requireAuth, cosmeticsController.equip);

router.post('/', requireAuth, requireAdmin, cosmeticsController.createCosmetic);
router.put('/:id', requireAuth, requireAdmin, cosmeticsController.updateCosmetic);
router.delete('/:id', requireAuth, requireAdmin, cosmeticsController.removeCosmetic);
router.post('/grant', requireAuth, requireAdmin, cosmeticsController.grant);

export default router;
