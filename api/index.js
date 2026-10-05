const app = require('../src/app');
const { connectDB } = require('../src/config/db');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('[Vercel Serverless] DB connection error:', err.message);
  }
  return app(req, res);
};
