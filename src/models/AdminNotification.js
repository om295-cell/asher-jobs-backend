const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['CHAIN_LINKED_RECOMMENDATION', 'PHONE_CONFLICT_DIFFERENT_NAMES', 'GENERAL'],
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['unread', 'read'],
      default: 'unread',
      index: true
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true
    },
    archivedAt: {
      type: Date,
      default: null
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecommendationRequest',
      index: true
    },
    requestNumber: {
      type: String,
      index: true
    },
    data: {
      conflictingPhone: { type: String, default: '' },
      firstListing: {
        requestNumber: String,
        submitterName: String,
        submitterPhone: String,
        submittedAt: Date,
        status: String
      },
      secondListing: {
        requestNumber: String,
        submitterName: String,
        submitterPhone: String,
        submittedAt: Date,
        recommendationsCount: Number,
        people: Array
      },
      chain: {
        parentRequestNumber: String,
        parentSubmitterName: String,
        parentSubmitterPhone: String,
        newRequestNumber: String,
        newSubmitterName: String,
        newSubmitterPhone: String,
        recommendationsCount: Number
      },
      resolution: {
        action: {
          type: String,
          enum: ['approved_both', 'rejected_main_keep_recommendations', 'reject_whole_listing', 'none'],
          default: 'none'
        },
        resolvedAt: Date,
        resolvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        notes: String
      }
    }
  },
  {
    timestamps: true
  }
);

adminNotificationSchema.index({ isArchived: 1, status: 1, createdAt: -1 });
adminNotificationSchema.index({ type: 1, isArchived: 1, createdAt: -1 });

module.exports = mongoose.model('AdminNotification', adminNotificationSchema);
