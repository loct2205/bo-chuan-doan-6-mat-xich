/**
 * Cấu hình site — sửa YOUR_* trước khi deploy Vercel.
 * Luồng thanh toán chính: SePay Cổng Thanh Toán (theo developer.sepay.vn)
 */
var SITE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby7unu5O0xJcu59PEuiovgjPaNENrIvGUwEIFgW5I93LtXoVRF-jP_7l5YL0Qn0AJHUfw/exec',
  SITE_URL: 'https://bo-chuan-doan-6-mat-xich.vercel.app/',

  /**
   * pg   = chỉ SePay Cổng (khuyến nghị, đúng docs SePay)
   * qr   = chỉ VietQR + webhook ngân hàng (dự phòng)
   * both = SePay Cổng + VietQR + PayPal
   */
  PAYMENT_MODE: 'pg',

  AMOUNT: 99000,
  ORDER_PREFIX: 'CD6X',

  PRODUCT_HUB: 'kho-qua.html',
  DRIVE_GIFTS: 'https://drive.google.com/drive/folders/1RGvMJAA9Ci8OBzavx8gdoztprWGstHMG?usp=sharing',

  PAYPAL_QR: 'PayPal_QR.JPG',
  PAYPAL_USD: 3.9,

  URGENCY_SLOTS: 20,
  COUNTDOWN_HOURS: 24
};
