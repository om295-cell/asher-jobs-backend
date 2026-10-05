const app = require('./app');
const { PORT } = require('./config/env');
const { connectDB, closeDB } = require('./config/db');
const { autoSeedIfEmpty } = require('./seed');

async function startServer() {
  try {
    await connectDB();

    // Initialize system taxonomies and ensure no seeded dummy data
    await autoSeedIfEmpty();

    const server = app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`🚀 Asher Jobs Backend Server running on port ${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/api/health`);
      console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
      console.log(`===============================================`);
    });

    const shutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
      server.close(async () => {
        await closeDB();
        console.log('[Server] Graceful shutdown completed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[Server Error] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
