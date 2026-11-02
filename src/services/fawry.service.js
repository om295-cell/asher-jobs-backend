/**
 * Fawry Payment Service (FawryPay)
 * Docs: https://developer.fawry.com / https://atfawry.com
 *
 * Flow:
 *  1. Create merchant order reference & calculate SHA-256 signature
 *  2. Initiate charge/checkout via FawryPay API or Hosted Checkout Page
 *  3. Fawry notifies our webhook (POST /payments/webhook) with signature verification
 *  4. Customer redirects back to callback (GET /payments/callback)
 *  5. Real-time status verification via Fawry Get Payment Status V2 API
 */

const axios = require('axios');
const crypto = require('crypto');

const FAWRY_MERCHANT_CODE = (process.env.FAWRY_MERCHANT_CODE || 'FAWRY_STAGING_CODE').trim();
const FAWRY_SECURITY_KEY  = (process.env.FAWRY_SECURITY_KEY  || 'FAWRY_STAGING_KEY').trim();
const FAWRY_ENV           = (process.env.FAWRY_ENV || 'staging').trim().toLowerCase();

const FAWRY_BASE = process.env.FAWRY_BASE_URL
  ? process.env.FAWRY_BASE_URL.replace(/\/+$/, '')
  : (FAWRY_ENV === 'production'
      ? 'https://www.atfawry.com'
      : 'https://atfawry.fawrystaging.com');

/**
 * Generate SHA-256 signature for checkout/hosted payment request
 * Formula: merchantCode + merchantRefNum + customerProfileId + returnUrl + sortedItems(itemId + quantity + formattedPrice) + secureKey
 */
function generateCheckoutSignature({
  merchantCode = FAWRY_MERCHANT_CODE,
  merchantRefNum,
  customerProfileId = '',
  returnUrl = '',
  items = [],
  secureKey = FAWRY_SECURITY_KEY
}) {
  const sortedItems = [...items].sort((a, b) => String(a.itemId).localeCompare(String(b.itemId)));
  let itemsStr = '';
  sortedItems.forEach(item => {
    const priceStr = Number(item.price).toFixed(2);
    itemsStr += `${item.itemId}${item.quantity}${priceStr}`;
  });

  const raw = `${merchantCode}${merchantRefNum}${customerProfileId || ''}${returnUrl}${itemsStr}${secureKey}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toLowerCase();
}

/**
 * Generate SHA-256 signature for direct charge endpoint (PAYATFAWRY, MWALLET, etc.)
 * Formula: merchantCode + merchantRefNum + (customerProfileId || '') + paymentMethod + amount (2 decimals) + secureKey
 */
function generateChargeSignature({
  merchantCode = FAWRY_MERCHANT_CODE,
  merchantRefNum,
  customerProfileId = '',
  paymentMethod = 'PAYATFAWRY',
  amount,
  secureKey = FAWRY_SECURITY_KEY
}) {
  const formattedAmount = Number(amount).toFixed(2);
  const raw = `${merchantCode}${merchantRefNum}${customerProfileId || ''}${paymentMethod}${formattedAmount}${secureKey}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toLowerCase();
}

/**
 * Generate SHA-256 signature for Status V2 endpoint
 * Formula: merchantCode + merchantRefNumber + secureKey
 */
function generateStatusSignature(merchantRefNumber, merchantCode = FAWRY_MERCHANT_CODE, secureKey = FAWRY_SECURITY_KEY) {
  const raw = `${merchantCode}${merchantRefNumber}${secureKey}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toLowerCase();
}

/**
 * Verify Fawry webhook notification signature
 * Formula: fawryRefNumber + merchantRefNumber + formattedAmount(2 decimals) + orderStatus + secureKey
 */
function verifyWebhookSignature(data, secureKey = FAWRY_SECURITY_KEY) {
  if (!data || !data.messageSignature) return false;

  const fawryRef = String(data.fawryRefNumber || data.referenceNumber || '');
  const merchantRef = String(data.merchantRefNumber || data.merchantRefNum || '');
  const amount = Number(data.paymentAmount || data.orderAmount || 0).toFixed(2);
  const status = String(data.orderStatus || data.status || '');
  const receivedSig = String(data.messageSignature).toLowerCase().trim();

  if (!/^[a-f0-9]{64}$/i.test(receivedSig)) {
    return false;
  }

  const raw = `${fawryRef}${merchantRef}${amount}${status}${secureKey}`;
  const calculatedSig = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toLowerCase();

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedSig, 'hex'),
      Buffer.from(receivedSig, 'hex')
    );
  } catch (err) {
    return false;
  }
}

/**
 * Initiate payment with Fawry
 * Returns { fawryRefNumber, paymentUrl, checkoutUrl, merchantRefNum }
 */
async function initiatePayment({ amountEgp, internalOrderId, customerData, planName, returnUrl }) {
  const merchantCode = FAWRY_MERCHANT_CODE;
  const secureKey = FAWRY_SECURITY_KEY;
  const merchantRefNum = String(internalOrderId);
  const formattedAmount = Number(amountEgp).toFixed(2);
  const customerProfileId = String(customerData?.companyId || internalOrderId);

  const finalReturnUrl = returnUrl ||
    `${process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://asher-jobs-frontend.vercel.app'}/company/subscription?payment=processing&order=${internalOrderId}`;

  const items = [
    {
      itemId: planName || 'SUBSCRIPTION',
      description: `Asher Jobs - ${planName} Plan`,
      price: formattedAmount,
      quantity: 1
    }
  ];

  const checkoutSignature = generateCheckoutSignature({
    merchantCode,
    merchantRefNum,
    customerProfileId,
    returnUrl: finalReturnUrl,
    items,
    secureKey
  });

  // Default hosted checkout payment URL
  let paymentUrl = `${FAWRY_BASE}/atfawry/plugin/assets/payments/js/fawrypay-payments.js`;
  let fawryRefNumber = null;

  // Try calling Fawry charge / init API
  try {
    const chargePayload = {
      merchantCode,
      merchantRefNum,
      customerProfileId,
      customerName: `${customerData?.firstName || 'Company'} ${customerData?.lastName || 'Account'}`.trim(),
      customerMobile: customerData?.phone || '01000000000',
      customerEmail: customerData?.email || 'finance@company.com',
      amount: formattedAmount,
      currencyCode: 'EGP',
      language: 'ar-eg',
      chargeItems: items,
      returnUrl: finalReturnUrl,
      signature: checkoutSignature
    };

    const res = await axios.post(
      `${FAWRY_BASE}/ECommerceWeb/Fawry/payments/charge`,
      chargePayload,
      { timeout: 8000 }
    );

    if (res.data) {
      if (res.data.redirectUrl) {
        paymentUrl = res.data.redirectUrl;
      } else if (res.data.checkoutUrl) {
        paymentUrl = res.data.checkoutUrl;
      }
      if (res.data.referenceNumber || res.data.fawryRefNumber) {
        fawryRefNumber = String(res.data.referenceNumber || res.data.fawryRefNumber);
      }
    }
  } catch (err) {
    // If the external Fawry staging/prod server is not directly reachable or keys are pending approval,
    // construct the standard FawryPay hosted checkout redirect URL
    const query = new URLSearchParams({
      merchantCode,
      merchantRefNum,
      customerProfileId,
      amount: formattedAmount,
      returnUrl: finalReturnUrl,
      signature: checkoutSignature
    });
    paymentUrl = `${FAWRY_BASE}/ECommerceWeb/Fawry/payments/checkout?${query.toString()}`;
  }

  return {
    merchantRefNum,
    fawryRefNumber,
    paymentUrl,
    checkoutSignature,
    amount: formattedAmount
  };
}

/**
 * Check payment status via Fawry Get Payment Status V2 API
 * GET /ECommerceWeb/Fawry/payments/status/v2
 */
async function checkPaymentStatus(merchantRefNumber) {
  try {
    const signature = generateStatusSignature(merchantRefNumber);
    const url = `${FAWRY_BASE}/ECommerceWeb/Fawry/payments/status/v2?merchantCode=${encodeURIComponent(FAWRY_MERCHANT_CODE)}&merchantRefNumber=${encodeURIComponent(merchantRefNumber)}&signature=${encodeURIComponent(signature)}`;
    const res = await axios.get(url, { timeout: 8000 });
    return res.data;
  } catch (err) {
    return null;
  }
}

module.exports = {
  FAWRY_MERCHANT_CODE,
  FAWRY_SECURITY_KEY,
  FAWRY_BASE,
  generateCheckoutSignature,
  generateChargeSignature,
  generateStatusSignature,
  verifyWebhookSignature,
  initiatePayment,
  checkPaymentStatus
};

