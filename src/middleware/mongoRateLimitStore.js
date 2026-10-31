const mongoose = require('mongoose');

const COLLECTION_NAME = 'rate_limit_windows';

// In-memory fallback map if MongoDB is momentarily connecting or unavailable
const memoryFallbackMap = new Map();

/**
 * Shared fixed-window store for express-rate-limit. Records live in MongoDB so
 * serverless instances and horizontal replicas share the same counters.
 * Resilient: Fails open (via in-memory fallback) rather than crashing incoming requests
 * if MongoDB is cold-starting or temporarily reconnecting.
 */
class MongoRateLimitStore {
  constructor(bucket) {
    this.bucket = bucket;
    this.windowMs = 60_000;
    this.collectionDb = null;
    this.collection = null;
    this.prefix = `${bucket}:`;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async getCollection() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return null;
    }
    const db = mongoose.connection.db;
    if (this.collectionDb !== db) {
      const collection = db.collection(COLLECTION_NAME);
      collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'rate_limit_expiry' }
      ).catch(() => {});
      this.collectionDb = db;
      this.collection = collection;
    }
    return this.collection;
  }

  _incrementMemory(key, now) {
    const id = `${this.bucket}:${key}`;
    const entry = memoryFallbackMap.get(id);
    if (!entry || entry.resetTime <= now) {
      const resetTime = new Date(now.getTime() + this.windowMs);
      memoryFallbackMap.set(id, { hits: 1, resetTime });
      return { totalHits: 1, resetTime };
    }
    entry.hits += 1;
    return { totalHits: entry.hits, resetTime: entry.resetTime };
  }

  async increment(key) {
    const now = new Date();
    try {
      const collection = await this.getCollection();
      if (!collection) {
        return this._incrementMemory(key, now);
      }

      const nextReset = new Date(now.getTime() + this.windowMs);
      const id = `${this.bucket}:${key}`;
      const result = await collection.findOneAndUpdate(
        { _id: id },
        [{
          $set: {
            bucket: { $literal: this.bucket },
            hits: {
              $cond: [
                { $gt: ['$expiresAt', now] },
                { $add: [{ $ifNull: ['$hits', 0] }, 1] },
                1
              ]
            },
            expiresAt: {
              $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', nextReset]
            }
          }
        }],
        { upsert: true, returnDocument: 'after' }
      );
      const record = result?.value || result;
      return { totalHits: record?.hits || 1, resetTime: record?.expiresAt || nextReset };
    } catch (err) {
      // Fail open: fallback to memory counter so connection drops never crash user traffic
      return this._incrementMemory(key, now);
    }
  }

  async decrement(key) {
    try {
      const collection = await this.getCollection();
      if (!collection) return;
      await collection.updateOne(
        { _id: `${this.bucket}:${key}`, hits: { $gt: 0 }, expiresAt: { $gt: new Date() } },
        { $inc: { hits: -1 } }
      );
    } catch (_) {}
  }

  async resetKey(key) {
    try {
      memoryFallbackMap.delete(`${this.bucket}:${key}`);
      const collection = await this.getCollection();
      if (!collection) return;
      await collection.deleteOne({ _id: `${this.bucket}:${key}` });
    } catch (_) {}
  }

  async resetAll() {
    try {
      memoryFallbackMap.clear();
      const collection = await this.getCollection();
      if (!collection) return;
      await collection.deleteMany({ bucket: this.bucket });
    } catch (_) {}
  }
}

module.exports = { MongoRateLimitStore };
