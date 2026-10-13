const mongoose = require('mongoose');

const paymentOrderSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    planName: {
      type: String,
      enum: ['Basic', 'Gold', 'Platinum'],
      required: true
    },
    billingMonths: {
      type: Number,
      enum: [1, 3, 6, 9, 12],
      required: true,
      default: 1
    },
    amountEgp: {
      type: Number,
      required: true
    },
    // Paymob fields
    paymobOrderId: { type: String, default: null, index: true },
    paymobPaymentKey: { type: String, default: null },
    paymobTransactionId: { type: String, default: null, index: true },
    // Status: pending → paid | failed | expired
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'expired'],
      default: 'pending',
      index: true
    },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    // Snapshot of plan limits at time of purchase (for audit)
    planSnapshot: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentOrder', paymentOrderSchema);
