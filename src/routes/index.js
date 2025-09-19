import express from 'express';
import healthRoutes from './healthRoutes.js';
import messageRoutes from './messageRoutes.js';
import imessageRoutes from './imessageRoutes.js';
import iCloudRoutes from './iCloudRoutes.js';

const router = express.Router();

// Health check routes
router.use('/', healthRoutes);

// Message routes
router.use('/', messageRoutes);

// iMessage routes
router.use('/', imessageRoutes);

// iCloud routes
router.use('/icloud', iCloudRoutes);

export default router; 