/**
 * Paymob Payment Service
 * Docs: https://docs.paymob.com/docs/accept-standard-redirect
 *
 * Flow:
 *  1. POST /auth/tokens          → get paymob auth token
 *  2. POST /ecommerce/orders     → register order, get paymob order_id
 *  3. POST /acceptance/payment_keys → get payment_key iframe token
 *  4. Redirect to iframe URL with payment_key
 *  5. Paymob calls our webhook on payment result
 */

const axios = require('axios');
const crypto = require('crypto');

const PAYMOB_API_KEY   = (process.env.PAYMOB_API_KEY   || '').trim();
const PAYMOB_HMAC_KEY  = (process.env.PAYMOB_HMAC_KEY  || '').trim();
// Strip non-digit characters in case an accidental prefix (like 'Y') or whitespace was copied
const PAYMOB_IFRAME_ID = (process.env.PAYMOB_IFRAME_ID || '').trim().replace(/\D/g, '');
const PAYMOB_INTEGRATION_ID = (process.env.PAYMOB_INTEGRATION_ID || '').trim().replace(/\D/g, ''); // card integration

const PAYMOB_BASE = 'https://accept.paymob.com/api';

/**
 * Step 1: Authenticate with Paymob and return auth_token
 */
async function getAuthToken() {
  const res = await axios.post(`${PAYMOB_BASE}/auth/tokens`, {
    api_key: PAYMOB_API_KEY
  });
  return res.data.token;
}

/**
 * Step 2: Register order with Paymob
 * @param {string} authToken
 * @param {number} amountCents  (EGP × 100)
 * @param {string} merchantOrderId  our internal order id
 * @returns {number} paymob order_id
 */
async function registerOrder(authToken, amountCents, merchantOrderId) {
  const res = await axios.post(`${PAYMOB_BASE}/ecommerce/orders`, {
    auth_token: authToken,
    delivery_needed: false,
    amount_cents: amountCents,
    currency: 'EGP',
    merchant_order_id: merchantOrderId,
    items: []
  });
  return res.data.id; // paymob order_id
}

/**
 * Step 3: Get payment key (iframe token)
 */
async function getPaymentKey(authToken, paymobOrderId, amountCents, billingData) {
  const res = await axios.post(`${PAYMOB_BASE}/acceptance/payment_keys`, {
    auth_token: authToken,
    amount_cents: amountCents,
    expiration: 3600, // 1 hour
    order_id: paymobOrderId,
    billing_data: {
      first_name:   billingData.firstName   || 'N/A',
      last_name:    billingData.lastName    || 'N/A',
      email:        billingData.email       || 'n@a.com',
      phone_number: billingData.phone       || '+201000000000',
      country:      'EG',
      city:         billingData.city        || 'Cairo',
      street:       billingData.street      || 'N/A',
      building:     'N/A',
      floor:        'N/A',
      apartment:    'N/A'
    },
    currency: 'EGP',
    integration_id: Number(PAYMOB_INTEGRATION_ID)
  });
  return res.data.token; // payment_key
}

/**
 * Build the Paymob iframe redirect URL
 */
function getIframeUrl(paymentKey) {
  return `https://accept.paymob.com/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentKey}`;
}

/**
 * Full flow: returns { paymobOrderId, paymentKey, iframeUrl }
 */
async function initiatePayment({ amountEgp, internalOrderId, billingData }) {
  const amountCents = Math.round(amountEgp * 100);
  const authToken = await getAuthToken();
  const paymobOrderId = await registerOrder(authToken, amountCents, internalOrderId);
  const paymentKey = await getPaymentKey(authToken, paymobOrderId, amountCents, billingData);
  const iframeUrl = getIframeUrl(paymentKey);
  return { paymobOrderId: String(paymobOrderId), paymentKey, iframeUrl };
}

/**
 * Verify Paymob HMAC webhook signature
 * https://docs.paymob.com/docs/transaction-webhooks
 */
function verifyHmac(data, receivedHmac) {
  // Paymob concatenates fields in a specific order
  const fields = [
    data.amount_cents,
    data.created_at,
    data.currency,
    data.error_occured,
    data.has_parent_transaction,
    data.id,
    data.integration_id,
    data.is_3d_secure,
    data.is_auth,
    data.is_capture,
    data.is_refunded,
    data.is_standalone_payment,
    data.is_voided,
    data.order?.id,
    data.owner,
    data.pending,
    data.source_data?.pan,
    data.source_data?.sub_type,
    data.source_data?.type,
    data.success
  ];
  const concatenated = fields.join('');
  const hmac = crypto
    .createHmac('sha512', PAYMOB_HMAC_KEY)
    .update(concatenated)
    .digest('hex');
  return hmac === receivedHmac;
}

module.exports = {
  initiatePayment,
  verifyHmac,
  getIframeUrl
};
