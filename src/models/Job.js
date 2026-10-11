const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    nameAr: {
      type: String,
      required: true,
      trim: true
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobCategory',
      required: true,
      index: true
    },
    description: {
      type: String,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    sortOrder: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

jobSchema.index({ name: 1, categoryId: 1 }, { unique: true });
jobSchema.index({ isActive: 1, sortOrder: 1, name: 1 });
jobSchema.index({ sortOrder: 1, name: 1 });
jobSchema.index({ categoryId: 1, isActive: 1 });

module.exports = mongoose.model('Job', jobSchema);
