/**
 * Cấu hình site — sửa YOUR_* trước khi deploy Vercel.
 * Luồng thanh toán chính: SePay Cổng Thanh Toán (theo developer.sepay.vn)
 */
var SITE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/THAY_BANG_DEPLOY_ID/exec',
  SITE_URL: 'https://YOUR-SITE.vercel.app',

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
