const mongoose = require('mongoose');

const jobCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    nameAr: {
      type: String,
      required: true,
      trim: true
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
    },
    // If true, this category was manually edited by admin.
    // The auto-seed system will NEVER override fields on manually-edited categories.
    manuallyEdited: {
      type: Boolean,
      default: false,
      index: true
    },
    // Used for the fallback category assigned to newly imported titles until
    // an admin chooses a more specific category during review.
    systemGenerated: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('JobCategory', jobCategorySchema);
