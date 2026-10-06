const mongoose = require('mongoose');
const { MONGO_URI, NODE_ENV } = require('./env');

let isConnected = false;

async function connectDB() {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || MONGO_URI;

  try {
    const maskedUri = uri ? uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : '';
    console.log(`[Database] Attempting connection to MongoDB at: ${maskedUri}`);
    await mongoose.connect(uri, {
      dbName: 'asher_jobs_db',
      serverSelectionTimeoutMS: 5000
    });
    console.log('[Database] MongoDB Connected Successfully.');
    return mongoose.connection;
  } catch (err) {
    console.warn(`[Database] Could not connect to primary MONGO_URI: ${err.message}`);

    // In local development only, attempt MongoMemoryServer if available
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        console.log('[Database] Attempting embedded MongoDB Memory Server...');
        const memoryServer = await MongoMemoryServer.create({
          instance: { dbName: 'asher_jobs_db' }
        });
        const memUri = memoryServer.getUri();
        await mongoose.connect(memUri);
        console.log(`[Database] Connected to In-Memory MongoDB at: ${memUri}`);
        mongoose._memoryServer = memoryServer;
        return mongoose.connection;
      } catch (memErr) {
        console.error('[Database] In-memory MongoDB also unavailable:', memErr.message);
      }
    }

    console.warn(
      '⚠️  [Database] Warning: No active MongoDB connection available. Please configure MONGO_URI in your environment variables (e.g. MongoDB Atlas on Vercel).'
    );
  }

  mongoose.connection.on('error', (err) => {
    console.error('[Database] MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[Database] MongoDB disconnected.');
  });
}

async function closeDB() {
  try {
    await mongoose.connection.close();
    if (mongoose._memoryServer) {
      await mongoose._memoryServer.stop();
    }
    console.log('[Database] Connection closed.');
  } catch (err) {
    console.error('[Database] Error closing DB:', err);
  }
}

module.exports = { connectDB, closeDB };
