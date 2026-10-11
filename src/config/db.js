const mongoose = require('mongoose');
const { MONGO_URI, NODE_ENV } = require('./env');

let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (cached.conn) {
    return cached.conn;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || MONGO_URI;

  if (!cached.promise) {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
    const connectOptions = {
      dbName: 'asher_jobs_db',
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
      family: 4, // Force IPv4 to avoid slow IPv6 DNS resolution
      autoIndex: !isProduction // Disable auto-indexing in production cold starts
    };

    const maskedUri = uri ? uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : '';
    console.log(`[Database] Attempting connection to MongoDB at: ${maskedUri}`);

    cached.promise = mongoose
      .connect(uri, connectOptions)
      .then((m) => {
        console.log('[Database] MongoDB Connected Successfully.');
        cached.conn = m.connection;
        return m.connection;
      })
      .catch(async (err) => {
        cached.promise = null;
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
            cached.conn = mongoose.connection;
            return mongoose.connection;
          } catch (memErr) {
            console.error('[Database] In-memory MongoDB also unavailable:', memErr.message);
          }
        }

        console.warn(
          '⚠️  [Database] Warning: No active MongoDB connection available. Please configure MONGO_URI in your environment variables.'
        );
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (e) {
    cached.promise = null;
    // Don't crash process if connection failed
    return mongoose.connection;
  }
}

mongoose.connection.on('error', (err) => {
  console.error('[Database] MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  if (cached) {
    cached.conn = null;
    cached.promise = null;
  }
  console.warn('[Database] MongoDB disconnected.');
});

async function closeDB() {
  try {
    if (cached) {
      cached.conn = null;
      cached.promise = null;
    }
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
