/**
 * QR online SePay — giống my.sepay.vn/createqr (chọn "QR online")
 * Website tự điền số tiền + mã đơn cho từng khách.
 *
 * SePay webhook URL (không trỏ thẳng GAS — GAS trả 302, SePay từ chối):
 *   https://bo-chuan-doan-6-mat-xich.vercel.app/api/sepay-webhook
 */
var SITE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzOnz00mRtqbMnSqlWFJ2lgZsAZbN5d5sEf39zL2VK1sy3FO14g0Z1JX1UsBCqszqnW0w/exec',
  SITE_URL: 'https://bo-chuan-doan-6-mat-xich.vercel.app',
  SEPAY_WEBHOOK_URL: 'https://bo-chuan-doan-6-mat-xich.vercel.app/api/sepay-webhook',

  AMOUNT: 9000,
  ORDER_PREFIX: 'DH',

  PRODUCT_HUB: 'kho-qua.html',
  DRIVE_GIFTS: 'https://drive.google.com/drive/folders/1RGvMJAA9Ci8OBzavx8gdoztprWGstHMG?usp=sharing',

  PAYPAL_QR: 'PayPal_QR.JPG',
  PAYPAL_USD: 3.9,

  URGENCY_SLOTS: 20,
  COUNTDOWN_HOURS: 24
};
