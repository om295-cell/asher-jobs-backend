const mongoose = require('mongoose');

const COLLECTION_NAME = 'rate_limit_windows';

/**
 * Shared fixed-window store for express-rate-limit. Records live in MongoDB so
 * serverless instances and horizontal replicas share the same counters.
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
      throw new Error('Shared rate-limit storage is unavailable.');
    }
    const db = mongoose.connection.db;
    if (this.collectionDb !== db) {
      const collection = db.collection(COLLECTION_NAME);
      await collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'rate_limit_expiry' }
      );
      this.collectionDb = db;
      this.collection = collection;
    }
    return this.collection;
  }

  async increment(key) {
    const collection = await this.getCollection();
    const now = new Date();
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
    return { totalHits: record.hits, resetTime: record.expiresAt };
  }

  async decrement(key) {
    const collection = await this.getCollection();
    await collection.updateOne(
      { _id: `${this.bucket}:${key}`, hits: { $gt: 0 }, expiresAt: { $gt: new Date() } },
      { $inc: { hits: -1 } }
    );
  }

  async resetKey(key) {
    const collection = await this.getCollection();
    await collection.deleteOne({ _id: `${this.bucket}:${key}` });
  }

  async resetAll() {
    const collection = await this.getCollection();
    await collection.deleteMany({ bucket: this.bucket });
  }
}

module.exports = { MongoRateLimitStore };
