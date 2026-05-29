import ImageProxy from '@server/lib/imageproxy';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();
const tadbImageProxy = new ImageProxy('tadb', 'https://r2.theaudiodb.com', {
  rateLimitOptions: {
    maxRequests: 20,
    maxRPS: 50,
  },
});

/**
 * Image Proxy
 */
router.get<{
  path: string[];
}>('/*path', async (req, res) => {
  const imagePath = '/' + req.params.path.join('/');

  if (imagePath.startsWith('//') || imagePath.includes('://')) {
    logger.error('Invalid URL for image proxy', { imagePath });
    return res.status(403).send('Invalid URL for image proxy');
  }

  try {
    const imageData = await tadbImageProxy.getImage(imagePath);

    res.writeHead(200, {
      'Content-Type': `image/${imageData.meta.extension}`,
      'Content-Length': imageData.imageBuffer.length,
      'Cache-Control': `public, max-age=${imageData.meta.curRevalidate}`,
      'OS-Cache-Key': imageData.meta.cacheKey,
      'OS-Cache-Status': imageData.meta.cacheMiss ? 'MISS' : 'HIT',
    });

    res.end(imageData.imageBuffer);
  } catch (e) {
    logger.error('Failed to proxy image', {
      imagePath,
      errorMessage: e.message,
    });
    res.status(500).send();
  }
});

export default router;
