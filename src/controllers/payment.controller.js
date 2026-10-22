const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const PaymentOrder = require('../models/PaymentOrder');
const paymobService = require('../services/paymob.service');
const { successResponse, errorResponse } = require('../utils/response');

// ─────────────────────────────────────────────────────────────
// GET /payments/plans  → public: list active plans for company-side display
// Dynamically marks the plan with the most completed orders/subscribers as isMostChosen
// ─────────────────────────────────────────────────────────────
async function listPlans(req, res) {
  try {
    const plans = await Subscription.find({ isActive: true })
      .sort({ priceEgp: 1 })
      .lean();

    // Dynamically calculate "الأكثر اختياراً" based on real completed payments, active subscriptions, and user choices
    const [paidOrderCounts, totalOrderCounts, companyCounts] = await Promise.all([
      PaymentOrder.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: '$planName', count: { $sum: 1 } } }
      ]).catch(() => []),
      PaymentOrder.aggregate([
        { $group: { _id: '$planName', count: { $sum: 1 } } }
      ]).catch(() => []),
      Company.aggregate([
        { $match: { subscriptionStatus: 'active', subscriptionPlan: { $in: ['Basic', 'Gold', 'Platinum'] } } },
        { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } }
      ]).catch(() => [])
    ]);

    const planStats = {};
    for (const item of paidOrderCounts || []) {
      if (item._id) planStats[item._id] = (planStats[item._id] || 0) + item.count * 10;
    }
    for (const item of companyCounts || []) {
      if (item._id) planStats[item._id] = (planStats[item._id] || 0) + item.count * 5;
    }
    for (const item of totalOrderCounts || []) {
      if (item._id) planStats[item._id] = (planStats[item._id] || 0) + item.count * 1;
    }

    // Determine the real top chosen plan
    let topPlanName = null;
    let maxScore = 0;
    for (const [name, score] of Object.entries(planStats)) {
      if (score > maxScore) {
        maxScore = score;
        topPlanName = name;
      }
    }

    // Only set isMostChosen if there are REAL choices (maxScore > 0)
    // NEVER fake or default to Gold if nobody actually chose it
    const enrichedPlans = plans.map(p => {
      const isTop = Boolean(topPlanName && maxScore > 0 && p.planName === topPlanName);
      return {
        ...p,
        isMostChosen: isTop,
        choiceScore: planStats[p.planName] || 0
      };
    });

    return successResponse(res, enrichedPlans);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch plans', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// POST /payments/initiate
// Body: { planName: 'Basic'|'Gold'|'Platinum', billingMonths: 1|3|6|9|12 }
// Returns: { orderId, iframeUrl }
// ─────────────────────────────────────────────────────────────
async function initiatePayment(req, res) {
  try {
    const company = req.company; // set by requireApprovedCompany middleware
    const { planName, billingMonths = 1 } = req.body;

    const validPlans = ['Basic', 'Gold', 'Platinum'];
    const validMonths = [1, 3, 6, 9, 12];

    if (!validPlans.includes(planName)) {
      return errorResponse(res, 'اختر باقة صحيحة (Basic, Gold, Platinum)', 400);
    }
    if (!validMonths.includes(Number(billingMonths))) {
      return errorResponse(res, 'مدة الاشتراك غير صحيحة', 400);
    }

    // Get plan pricing from DB
    const plan = await Subscription.findOne({ planName, isActive: true }).lean();
    if (!plan) {
      return errorResponse(res, 'الباقة غير متاحة حالياً', 404);
    }

    const months = Number(billingMonths);
    const basePrice = plan.priceEgp || plan.priceMonthlyEgp;

    const now = new Date();
    const isDiscountActive = Boolean(
      (Number(plan.discountPct) > 0) &&
      (!plan.discountStartsAt || new Date(plan.discountStartsAt) <= now) &&
      (!plan.discountEndsAt || new Date(plan.discountEndsAt) >= now)
    );

    // Plan-level promo discount (configured by admin on the package)
    const planDiscountPct = isDiscountActive ? Math.min(100, Math.max(0, Number(plan.discountPct) || 0)) : 0;
    const priceAfterPlanDiscount = basePrice * (1 - planDiscountPct / 100);

    // Billing cycle duration loyalty discount
    let cycleDiscountPct = 0;
    if (months === 3)  cycleDiscountPct = 5;
    if (months === 6)  cycleDiscountPct = 10;
    if (months === 9)  cycleDiscountPct = 15;
    if (months === 12) cycleDiscountPct = 20;

    const totalBeforeCycleDiscount = priceAfterPlanDiscount * months;
    const cycleDiscountAmount = Math.round(totalBeforeCycleDiscount * cycleDiscountPct / 100);
    const totalAmountEgp = Math.max(0, Math.round(totalBeforeCycleDiscount - cycleDiscountAmount));

    const totalBeforeAnyDiscount = basePrice * months;
    const totalDiscountAmount = Math.max(0, totalBeforeAnyDiscount - totalAmountEgp);
    const effectiveDiscountPct = totalBeforeAnyDiscount > 0 ? Math.round((totalDiscountAmount / totalBeforeAnyDiscount) * 100) : 0;

    // Create internal order record
    const order = await PaymentOrder.create({
      companyId: company._id,
      userId: req.user._id,
      planName,
      billingMonths: months,
      amountEgp: totalAmountEgp,
      status: 'pending',
      planSnapshot: plan
    });

    // Split company name into first/last for billing
    const nameParts = (company.companyName || 'Company').split(' ');
    const billingData = {
      firstName: nameParts[0] || 'Company',
      lastName:  nameParts.slice(1).join(' ') || 'Account',
      email:     company.email || 'no@email.com',
      phone:     company.phone || '+201000000000',
      city:      company.governorate || 'Cairo',
      street:    company.area || 'N/A'
    };

    // Initiate Paymob payment
    const { paymobOrderId, paymentKey, iframeUrl } = await paymobService.initiatePayment({
      amountEgp: totalAmountEgp,
      internalOrderId: order._id.toString(),
      billingData
    });

    // Save Paymob IDs back to order
    order.paymobOrderId = paymobOrderId;
    order.paymobPaymentKey = paymentKey;
    await order.save();

    return successResponse(res, {
      orderId: order._id,
      iframeUrl,
      summary: {
        planName,
        billingMonths: months,
        basePricePerMonth: basePrice,
        planDiscountPct,
        planDiscountLabel: plan.discountLabel || '',
        cycleDiscountPct,
        discountPct: effectiveDiscountPct,
        discountAmount: totalDiscountAmount,
        totalAmountEgp
      }
    });
  } catch (err) {
    console.error('[Payment/initiate] Error:', err.message);
    return errorResponse(res, 'فشل بدء عملية الدفع. حاول مرة أخرى.', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// POST /payments/webhook  (called by Paymob on payment result)
// ─────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  try {
    const hmac = req.query.hmac;
    const data = req.body.obj || req.body;

    // OWASP A08: Strictly enforce Paymob HMAC webhook signature
    const hmacKey = process.env.PAYMOB_HMAC_KEY;
    if (!hmacKey) {
      console.error('[Payment/webhook] SECURITY ERROR: PAYMOB_HMAC_KEY is not configured on server.');
      return res.status(500).json({ error: 'Webhook signature verification key not configured' });
    }

    if (!hmac) {
      console.warn('[Payment/webhook] SECURITY ALERT: Webhook called without HMAC signature.');
      return res.status(401).json({ error: 'HMAC signature required' });
    }

    const valid = paymobService.verifyHmac(data, hmac);
    if (!valid) {
      console.warn('[Payment/webhook] SECURITY ALERT: Invalid HMAC signature detected.');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const paymobOrderId = String(data.order?.id || data.order);
    const transactionId = String(data.id);
    const success = data.success === true || data.success === 'true';

    const order = await PaymentOrder.findOne({ paymobOrderId });
    if (!order) {
      console.warn('[Payment/webhook] Order not found for paymobOrderId:', paymobOrderId);
      return res.status(200).json({ received: true });
    }

    if (order.status === 'paid') {
      return res.status(200).json({ received: true }); // idempotent
    }

    order.paymobTransactionId = transactionId;

    if (success) {
      // Validate payment amount (in cents/piastres) against order amount to prevent price tampering
      const transactionAmountCents = Number(data.amount_cents);
      const expectedAmountCents = Math.round(order.amountEgp * 100);
      if (transactionAmountCents && Math.abs(transactionAmountCents - expectedAmountCents) > 100) {
        console.warn(`[Payment/webhook] Amount mismatch detected: received ${transactionAmountCents}, expected ${expectedAmountCents}`);
        order.status = 'failed';
        order.failureReason = 'Amount mismatch detected';
        await order.save();
        return res.status(200).json({ received: true });
      }

      order.status = 'paid';
      order.paidAt = new Date();

      // Activate subscription on company
      const months = order.billingMonths;
      const startDate = new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + months);

      await Company.findByIdAndUpdate(order.companyId, {
        subscriptionPlan: order.planName,
        subscriptionStatus: 'active',
        subscriptionStartDate: startDate,
        subscriptionEndDate: endDate,
        subscriptionPriceEgp: order.amountEgp
      });
    } else {
      order.status = 'failed';
      order.failureReason = data.data?.message || 'Payment declined';
    }

    await order.save();
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Payment/webhook] Error:', err.message);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET /payments/callback  (browser redirect from Paymob iframe)
// Purely redirects the user — never activates subscriptions directly
// ─────────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  try {
    const { success, order: paymobOrderId } = req.query;
    const FRONTEND_URL = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://asher-jobs-frontend.vercel.app';
    const isSuccess = success === 'true';

    if (isSuccess && paymobOrderId) {
      const order = await PaymentOrder.findOne({ paymobOrderId: String(paymobOrderId) });
      if (order && order.status === 'paid') {
        return res.redirect(`${FRONTEND_URL}/company/subscription?payment=success&order=${order._id}`);
      }
      // If webhook hasn't processed it yet, redirect to processing status
      return res.redirect(`${FRONTEND_URL}/company/subscription?payment=processing&order=${paymobOrderId}`);
    } else {
      return res.redirect(`${FRONTEND_URL}/company/subscription?payment=failed`);
    }
  } catch (err) {
    console.error('[Payment/callback] Error:', err.message);
    const FRONTEND_URL = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://asher-jobs-frontend.vercel.app';
    return res.redirect(`${FRONTEND_URL}/company/subscription?payment=error`);
  }
}

// ─────────────────────────────────────────────────────────────
// GET /payments/my-orders  → company's payment history (only completed/paid and refunded)
// ─────────────────────────────────────────────────────────────
async function getMyOrders(req, res) {
  try {
    const orders = await PaymentOrder.find({
      companyId: req.company._id,
      status: { $in: ['paid', 'refunded'] }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return successResponse(res, orders);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch payment history', 500);
  }
}

module.exports = {
  listPlans,
  initiatePayment,
  handleWebhook,
  handleCallback,
  getMyOrders
};
