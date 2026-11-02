const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const PaymentOrder = require('../models/PaymentOrder');
const paymobService = require('../services/paymob.service');
const fawryService = require('../services/fawry.service');
const { successResponse, errorResponse } = require('../utils/response');

async function activateSubscriptionForOrder(order) {
  const startDate = order.paidAt ? new Date(order.paidAt) : new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + order.billingMonths);

  await Company.findOneAndUpdate(
    {
      _id: order.companyId,
      $or: [
        { subscriptionPaymentOrderId: null },
        { subscriptionPaymentOrderId: order._id },
        { subscriptionStartDate: { $lte: startDate } }
      ]
    },
    { $set: {
      subscriptionPlan: order.planName,
      subscriptionStatus: 'active',
      subscriptionStartDate: startDate,
      subscriptionEndDate: endDate,
      subscriptionPriceEgp: order.amountEgp,
      subscriptionPaymentOrderId: order._id
    } },
    { new: true }
  );
}

async function deactivateSubscriptionForRefund(order) {
  const subscriptionMatch = [{ subscriptionPaymentOrderId: order._id }];
  // Support older orders created before the source-order reference was stored,
  // but only when their activation timestamp matches this payment.
  if (order.paidAt) {
    const paidAt = new Date(order.paidAt);
    subscriptionMatch.push({
      subscriptionPaymentOrderId: null,
      subscriptionPlan: order.planName,
      subscriptionStartDate: {
        $gte: new Date(paidAt.getTime() - 5 * 60 * 1000),
        $lte: new Date(paidAt.getTime() + 5 * 60 * 1000)
      }
    });
  }
  await Company.updateOne(
    { _id: order.companyId, subscriptionStatus: 'active', $or: subscriptionMatch },
    { $set: { subscriptionStatus: 'inactive' } }
  );
}

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

    const activeGateway = (process.env.PAYMENT_GATEWAY || 'fawry').trim().toLowerCase();

    // Create internal order record
    const order = await PaymentOrder.create({
      companyId: company._id,
      userId: req.user._id,
      planName,
      billingMonths: months,
      amountEgp: totalAmountEgp,
      status: 'pending',
      paymentGateway: activeGateway,
      merchantRefNumber: null,
      planSnapshot: plan
    });
    order.merchantRefNumber = order._id.toString();

    // Split company name into first/last for billing
    const nameParts = (company.companyName || 'Company').split(' ');
    const billingData = {
      firstName: nameParts[0] || 'Company',
      lastName:  nameParts.slice(1).join(' ') || 'Account',
      email:     company.email || 'finance@company.com',
      phone:     company.phone || '+201000000000',
      city:      company.governorate || 'Cairo',
      street:    company.area || 'N/A'
    };

    let paymentUrl = '';
    let iframeUrl = '';

    if (activeGateway === 'fawry') {
      const fawryResult = await fawryService.initiatePayment({
        amountEgp: totalAmountEgp,
        internalOrderId: order._id.toString(),
        customerData: {
          companyId: company._id.toString(),
          firstName: billingData.firstName,
          lastName: billingData.lastName,
          email: billingData.email,
          phone: billingData.phone
        },
        planName
      });

      paymentUrl = fawryResult.paymentUrl;
      iframeUrl = fawryResult.paymentUrl; // backwards-compatible redirect
      if (fawryResult.fawryRefNumber) {
        order.fawryRefNumber = fawryResult.fawryRefNumber;
      }
      await order.save();
    } else {
      // Legacy Paymob flow
      const { paymobOrderId, paymentKey, iframeUrl: pmIframeUrl } = await paymobService.initiatePayment({
        amountEgp: totalAmountEgp,
        internalOrderId: order._id.toString(),
        billingData
      });
      order.paymobOrderId = paymobOrderId;
      order.paymobPaymentKey = paymentKey;
      paymentUrl = pmIframeUrl;
      iframeUrl = pmIframeUrl;
      await order.save();
    }

    return successResponse(res, {
      orderId: order._id,
      paymentUrl,
      iframeUrl,
      gateway: activeGateway,
      fawryRefNumber: order.fawryRefNumber || null,
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
// POST /payments/webhook  (called by Fawry or Paymob on payment result)
// ─────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  try {
    const isFawryWebhook = Boolean(
      req.body?.fawryRefNumber ||
      req.body?.merchantRefNumber ||
      req.body?.messageSignature ||
      (req.body?.orderStatus && !req.query?.hmac && !req.body?.obj)
    );

    // ── 1. Fawry Webhook Handling ──────────────────────────────
    if (isFawryWebhook) {
      const fawryKey = process.env.FAWRY_SECURITY_KEY;
      if (!fawryKey) {
        console.error('[Payment/webhook/fawry] SECURITY ERROR: FAWRY_SECURITY_KEY is not configured on server.');
        return res.status(500).json({ error: 'Fawry signature verification key not configured' });
      }

      if (!req.body?.messageSignature) {
        console.warn('[Payment/webhook/fawry] SECURITY ALERT: Webhook called without signature.');
        return res.status(401).json({ error: 'Signature required' });
      }

      const validFawry = fawryService.verifyWebhookSignature(req.body, fawryKey);
      if (!validFawry) {
        console.warn('[Payment/webhook/fawry] SECURITY ALERT: Invalid Fawry signature detected.');
        return res.status(401).json({ error: 'Invalid Fawry signature' });
      }

      const merchantRef = String(req.body.merchantRefNumber || req.body.merchantRefNum || '');
      const fawryRefNumber = String(req.body.fawryRefNumber || req.body.referenceNumber || '');
      const fawryStatus = String(req.body.orderStatus || req.body.status || '').toUpperCase();
      const transactionId = fawryRefNumber || String(req.body.requestId || Date.now());

      const orderQuery = [];
      if (merchantRef) {
        if (/^[0-9a-fA-F]{24}$/.test(merchantRef)) orderQuery.push({ _id: merchantRef });
        orderQuery.push({ merchantRefNumber: merchantRef });
      }
      if (fawryRefNumber) orderQuery.push({ fawryRefNumber });

      const order = await PaymentOrder.findOne(orderQuery.length ? { $or: orderQuery } : { merchantRefNumber: merchantRef });
      if (!order) {
        console.warn('[Payment/webhook/fawry] Order not found for merchantRef:', merchantRef);
        return res.status(200).json({ received: true });
      }

      const isRefunded = fawryStatus === 'REFUNDED' || req.body.is_refunded === true;
      if (isRefunded) {
        if (order.status !== 'refunded') {
          await PaymentOrder.findOneAndUpdate(
            { _id: order._id, status: { $ne: 'refunded' } },
            { $set: {
              fawryRefNumber,
              fawryTransactionId: transactionId,
              paymobRefundTransactionId: transactionId,
              status: 'refunded',
              refundedAt: new Date(),
              refundReason: 'Refund confirmed by Fawry'
            } },
            { new: true }
          );
        }
        await deactivateSubscriptionForRefund(order);
        return res.status(200).json({ received: true });
      }

      if (order.status === 'paid') {
        if (fawryStatus === 'PAID' || fawryStatus === 'SUCCESS') {
          await activateSubscriptionForOrder(order);
          const latestOrder = await PaymentOrder.findById(order._id).select('status').lean();
          if (latestOrder?.status === 'refunded') {
            await deactivateSubscriptionForRefund(order);
          }
        }
        return res.status(200).json({ received: true });
      }

      if (order.status === 'refunded') {
        return res.status(200).json({ received: true });
      }

      if (fawryStatus === 'PAID' || fawryStatus === 'SUCCESS') {
        const receivedAmount = Number(req.body.paymentAmount || req.body.orderAmount || 0);
        const expectedAmount = Number(order.amountEgp);

        if (Math.abs(receivedAmount - expectedAmount) > 0.05) {
          console.warn(`[Payment/webhook/fawry] Amount mismatch: received ${receivedAmount}, expected ${expectedAmount}`);
          await PaymentOrder.findOneAndUpdate(
            { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
            { $set: {
              fawryRefNumber,
              fawryTransactionId: transactionId,
              status: 'failed',
              failureReason: 'Amount mismatch detected'
            } }
          );
          return res.status(200).json({ received: true });
        }

        const paidAt = new Date();
        const paidOrder = await PaymentOrder.findOneAndUpdate(
          { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
          { $set: {
            fawryRefNumber,
            fawryTransactionId: transactionId,
            fawryPaymentMethod: req.body.paymentMethod || 'FAWRY',
            paymobTransactionId: transactionId,
            status: 'paid',
            paidAt,
            failureReason: ''
          } },
          { new: true }
        );
        if (!paidOrder) return res.status(200).json({ received: true });

        await activateSubscriptionForOrder(paidOrder);

        const latestOrder = await PaymentOrder.findById(paidOrder._id).select('status').lean();
        if (latestOrder?.status === 'refunded') {
          await deactivateSubscriptionForRefund(paidOrder);
        }
      } else {
        await PaymentOrder.findOneAndUpdate(
          { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
          { $set: {
            fawryRefNumber,
            fawryTransactionId: transactionId,
            status: fawryStatus === 'EXPIRED' ? 'expired' : 'failed',
            failureReason: req.body.statusDescription || `Fawry status: ${fawryStatus}`
          } }
        );
      }

      return res.status(200).json({ received: true });
    }

    // ── 2. Paymob Webhook Handling (Preserved for compatibility) ─
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

    if (!paymobService.isExpectedIntegration(data)) {
      console.warn('[Payment/webhook] SECURITY ALERT: Transaction integration does not match configured Paymob integration.');
      return res.status(401).json({ error: 'Invalid payment integration' });
    }

    const paymobOrderId = String(data.order?.id || data.order);
    const transactionId = String(data.id);
    const success = data.success === true || data.success === 'true';

    const order = await PaymentOrder.findOne({ paymobOrderId });
    if (!order) {
      console.warn('[Payment/webhook] Order not found for paymobOrderId:', paymobOrderId);
      return res.status(200).json({ received: true });
    }

    // Refund notifications are valid even after the original success event has
    // marked the order paid. Process them before the success replay guard.
    const isRefunded = data.is_refunded === true || data.is_refunded === 'true';
    if (isRefunded) {
      if (order.status !== 'refunded') {
        await PaymentOrder.findOneAndUpdate(
          { _id: order._id, status: { $ne: 'refunded' } },
          { $set: {
            paymobRefundTransactionId: transactionId,
            status: 'refunded',
            refundedAt: new Date(),
            refundReason: 'Refund confirmed by Paymob'
          } },
          { new: true }
        );
      }
      // Retry revocation even if the order was already marked refunded but a
      // prior attempt failed before updating the company record.
      await deactivateSubscriptionForRefund(order);
      return res.status(200).json({ received: true });
    }

    // A replay after a partial failure repairs activation from the durable paid
    // order. The linked-order filter prevents an older retry replacing a newer plan.
    if (order.status === 'paid') {
      if (success) {
        await activateSubscriptionForOrder(order);
        const latestOrder = await PaymentOrder.findById(order._id).select('status').lean();
        if (latestOrder?.status === 'refunded') {
          await deactivateSubscriptionForRefund(order);
        }
      }
      return res.status(200).json({ received: true });
    }

    // SEC-34: a replayed success event must not reactivate a refunded order.
    if (order.status === 'refunded') {
      return res.status(200).json({ received: true });
    }

    if (success) {
      // Validate payment amount (in cents/piastres) against order amount to prevent price tampering
      const transactionAmountCents = Number(data.amount_cents);
      const expectedAmountCents = Math.round(order.amountEgp * 100);
      const currency = String(data.currency || '').toUpperCase();
      if (
        data.amount_cents === undefined ||
        data.amount_cents === null ||
        data.amount_cents === '' ||
        !Number.isSafeInteger(transactionAmountCents) ||
        transactionAmountCents !== expectedAmountCents ||
        currency !== 'EGP'
      ) {
        console.warn(`[Payment/webhook] Amount/currency mismatch detected: received ${data.amount_cents} ${currency || '(missing)'}, expected ${expectedAmountCents} EGP`);
        await PaymentOrder.findOneAndUpdate(
          { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
          { $set: {
            paymobTransactionId: transactionId,
            status: 'failed',
            failureReason: 'Amount or currency mismatch detected'
          } }
        );
        return res.status(200).json({ received: true });
      }

      const paidAt = new Date();
      const paidOrder = await PaymentOrder.findOneAndUpdate(
        { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
        { $set: {
          paymobTransactionId: transactionId,
          status: 'paid',
          paidAt,
          failureReason: ''
        } },
        { new: true }
      );
      if (!paidOrder) return res.status(200).json({ received: true });

      // Activate subscription on company
      await activateSubscriptionForOrder(paidOrder);

      const latestOrder = await PaymentOrder.findById(paidOrder._id).select('status').lean();
      if (latestOrder?.status === 'refunded') {
        await deactivateSubscriptionForRefund(paidOrder);
      }
    } else {
      await PaymentOrder.findOneAndUpdate(
        { _id: order._id, status: { $nin: ['paid', 'refunded'] } },
        { $set: {
          paymobTransactionId: transactionId,
          status: 'failed',
          failureReason: data.data?.message || 'Payment declined'
        } }
      );
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Payment/webhook] Error:', err.message);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET /payments/callback  (browser redirect from Fawry or Paymob)
// ─────────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  try {
    const { success, order: paymobOrderId, merchantRefNumber, merchantRefNum, orderStatus, statusCode } = req.query;
    const FRONTEND_URL = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://asher-jobs-frontend.vercel.app';

    // ── Fawry Redirect Callback ───────────────────────────────
    const fawryRef = merchantRefNumber || merchantRefNum;
    if (fawryRef) {
      const order = await PaymentOrder.findOne({
        $or: [
          ...(fawryRef.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: fawryRef }] : []),
          { merchantRefNumber: fawryRef }
        ]
      });

      if (order && order.status === 'paid') {
        return res.redirect(`${FRONTEND_URL}/company/subscription?payment=success&order=${order._id}`);
      }

      // Check real-time status with Fawry Status API if pending
      if (order && order.status === 'pending') {
        const liveStatus = await fawryService.checkPaymentStatus(fawryRef);
        const liveStatusStr = String(liveStatus?.orderStatus || liveStatus?.status || '').toUpperCase();
        if (liveStatusStr === 'PAID' || liveStatusStr === 'SUCCESS') {
          order.status = 'paid';
          order.paidAt = new Date();
          if (liveStatus?.referenceNumber) order.fawryRefNumber = String(liveStatus.referenceNumber);
          await order.save();
          await activateSubscriptionForOrder(order);
          return res.redirect(`${FRONTEND_URL}/company/subscription?payment=success&order=${order._id}`);
        }
      }

      const isFawrySuccess = orderStatus === 'PAID' || statusCode === '200' || statusCode === 200;
      if (isFawrySuccess) {
        return res.redirect(`${FRONTEND_URL}/company/subscription?payment=processing&order=${fawryRef}`);
      }
      return res.redirect(`${FRONTEND_URL}/company/subscription?payment=failed&order=${fawryRef}`);
    }

    // ── Paymob Redirect Callback ──────────────────────────────
    const isSuccess = success === 'true';

    if (isSuccess && paymobOrderId) {
      const order = await PaymentOrder.findOne({ paymobOrderId: String(paymobOrderId) });
      if (order && order.status === 'paid') {
        return res.redirect(`${FRONTEND_URL}/company/subscription?payment=success&order=${order._id}`);
      }
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
