const mongoose = require('mongoose');
const { MONGO_URI, NODE_ENV } = require('./env');

async function connectDB() {
  try {
    console.log(`[Database] Attempting connection to MongoDB at: ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('[Database] MongoDB Connected Successfully.');
  } catch (err) {
    console.warn(`[Database] Could not connect to primary MONGO_URI: ${err.message}`);

    // Attempt MongoMemoryServer if available (requires prior download)
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const cachedBinary = require('mongodb-memory-server-core/lib/util/MongoBinary').MongoBinary;
      console.log('[Database] Attempting embedded MongoDB Memory Server...');
      const memoryServer = await MongoMemoryServer.create({
        instance: { dbName: 'asher_jobs_db' }
      });
      const uri = memoryServer.getUri();
      await mongoose.connect(uri);
      console.log(`[Database] Connected to In-Memory MongoDB at: ${uri}`);
      // Attach reference for graceful shutdown
      mongoose._memoryServer = memoryServer;
    } catch (memErr) {
      console.error('[Database] In-memory MongoDB also unavailable:', memErr.message);
      console.error('\n⚠️  IMPORTANT: Please install and start MongoDB locally:');
      console.error('   Option 1: Install MongoDB Community: https://www.mongodb.com/try/download/community');
      console.error('   Option 2: Use MongoDB Atlas (cloud): https://www.mongodb.com/cloud/atlas');
      console.error('   Then update MONGO_URI in server/.env\n');
      throw new Error('No database available. Please install MongoDB and set MONGO_URI in .env');
    }
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
