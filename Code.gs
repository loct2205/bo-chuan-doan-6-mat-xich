/**
 * ============================================================
 *  Backend Google Apps Script — SePay Cổng Thanh Toán
 *  Docs: https://developer.sepay.vn/vi/cong-thanh-toan/bat-dau
 *
 *  Luồng chính (Payment Gateway):
 *   1. Web gọi action=create → GAS ký form HMAC → trả checkout_url + fields
 *   2. Khách POST form → pay-sandbox.sepay.vn (hoặc pay.sepay.vn)
 *   3. SePay gọi IPN (POST JSON) → đánh dấu paid + gửi email
 *   4. SePay redirect success_url / error_url / cancel_url
 *
 *  Luồng dự phòng: VietQR + webhook ngân hàng (my.sepay.vn → Webhooks)
 * ============================================================
 */

// ----------------------- CONFIG -----------------------------
var CONFIG = {
  BANK_ACCOUNT : '08363636888',
  BANK_CODE    : 'TPBank',
  HOLDER       : 'TRAN XUAN LOC',

  // IPN + webhook: ?key=... trên URL deploy GAS
  SEPAY_API_KEY: 'DOI_THANH_KEY_BAO_MAT_CUA_BAN',

  // SePay Payment Gateway — my.sepay.vn → Cổng thanh toán
  PG_MERCHANT_ID: 'SP-TEST-TX392673',
  PG_SECRET_KEY : 'DAN_SECRET_KEY_PG',
  PG_ENV        : 'sandbox',  // 'sandbox' | 'production'

  SITE_URL     : 'https://YOUR-SITE.vercel.app',
  PRODUCT_NAME : 'Bộ Chẩn Đoán 6 Mắt Xích',
  PRODUCT_URL  : 'https://YOUR-SITE.vercel.app/kho-qua.html',
  DRIVE_GIFTS  : 'https://drive.google.com/drive/folders/1RGvMJAA9Ci8OBzavx8gdoztprWGstHMG?usp=sharing',

  SHEET_NAME   : 'orders',
  ORDER_TTL_MIN: 30,
};
// ------------------------------------------------------------


// ============ TIỆN ÍCH: lấy/ tạo sheet đơn hàng =============
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
    sh.appendRow(['order_code','amount','email','name','status',
                  'created_at','paid_at','sepay_tx_id','delivered']);
  }
  return sh;
}

// Tìm dòng theo mã đơn. Trả {row, data} hoặc null.
function findOrder_(sh, code) {
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(code)) {
      return { row: r + 1, data: values[r] };
    }
  }
  return null;
}

function parseMoney_(val) {
  if (val === undefined || val === null || val === '') return 0;
  return Math.round(parseFloat(String(val).replace(/,/g, '')) || 0);
}

function markOrderPaid_(sh, rowNum, txId, email, name, code) {
  var values = sh.getDataRange().getValues();
  var row = values[rowNum - 1];
  if (!row || row[4] === 'paid') return false;

  sh.getRange(rowNum, 5).setValue('paid');
  sh.getRange(rowNum, 7).setValue(new Date());
  sh.getRange(rowNum, 8).setValue(String(txId || 'pg-' + Date.now()));

  if (row[8] !== 'yes') {
    try {
      deliver_(email || row[2], name || row[3], code || row[0]);
      sh.getRange(rowNum, 9).setValue('yes');
    } catch (err) {
      sh.getRange(rowNum, 9).setValue('email_failed');
    }
  }
  return true;
}

function resolveSiteUrl_(p) {
  var fromReq = (p && p.site_url) ? String(p.site_url).replace(/\/$/, '') : '';
  if (fromReq && fromReq.indexOf('YOUR-') === -1) return fromReq;
  var site = String(CONFIG.SITE_URL || '').replace(/\/$/, '');
  if (site && site.indexOf('YOUR-') === -1) return site;
  return String(CONFIG.PRODUCT_URL || '').replace(/\/kho-qua\.html.*$/, '');
}

function resolveProductUrl_(site) {
  var url = String(CONFIG.PRODUCT_URL || '');
  if (url && url.indexOf('YOUR-') === -1) return url;
  return site + '/kho-qua.html';
}

function pgConfigured_() {
  return CONFIG.PG_MERCHANT_ID &&
    CONFIG.PG_SECRET_KEY &&
    CONFIG.PG_SECRET_KEY.indexOf('DAN_') !== 0;
}


// ===================== ENDPOINT GET ==========================
// Web gọi vào đây để: tạo đơn (action=create) hoặc hỏi trạng thái (action=status)
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || '';

  if (action === 'create') {
    return createOrder_(p);
  }
  if (action === 'status') {
    return checkStatus_(p);
  }
  return json_({ ok: false, error: 'unknown_action' });
}

// --- Tạo đơn mới: trả về mã đơn + thông tin để web sinh QR ---
function createOrder_(p) {
  var amount = parseInt(p.amount, 10) || 0;
  var email  = (p.email || '').trim();
  var name   = (p.name  || '').trim();
  if (amount <= 0 || !email) {
    return json_({ ok: false, error: 'missing_amount_or_email' });
  }

  // Mã đơn: chỉ chữ + số (SePay 'des' yêu cầu không dấu). Ví dụ: SCAN A1B2C3
  var code = (p.prefix || 'SCAN') + Math.random().toString(36)
               .slice(2, 8).toUpperCase();

  var sh = getSheet_();
  sh.appendRow([code, amount, email, name, 'pending',
                new Date(), '', '', 'no']);

  var site = resolveSiteUrl_(p);
  var productUrl = resolveProductUrl_(site);

  return json_({
    ok: true,
    order_code: code,
    amount: amount,
    bank_account: CONFIG.BANK_ACCOUNT,
    bank_code: CONFIG.BANK_CODE,
    qr_url: 'https://qr.sepay.vn/img?acc=' + CONFIG.BANK_ACCOUNT +
            '&bank=' + encodeURIComponent(CONFIG.BANK_CODE) +
            '&amount=' + amount +
            '&des=' + encodeURIComponent(code) +
            '&holder=' + encodeURIComponent(CONFIG.HOLDER) +
            '&template=compact',
    pg: buildPgCheckout_(code, amount, email, site, productUrl)
  });
}

// --- SePay PG: ký HMAC-SHA256 theo docs developer.sepay.vn ---
function signPgFields_(fields, secretKey) {
  var order = [
    'order_amount', 'merchant', 'currency', 'operation',
    'order_description', 'order_invoice_number', 'customer_id',
    'payment_method', 'success_url', 'error_url', 'cancel_url'
  ];
  var parts = [];
  for (var i = 0; i < order.length; i++) {
    var k = order[i];
    if (fields[k] !== undefined && fields[k] !== null && String(fields[k]) !== '') {
      parts.push(k + '=' + fields[k]);
    }
  }
  var raw = Utilities.computeHmacSha256Signature(parts.join(','), secretKey);
  return Utilities.base64Encode(raw);
}

function getPgCheckoutUrl_() {
  return CONFIG.PG_ENV === 'production'
    ? 'https://pay.sepay.vn/v1/checkout/init'
    : 'https://pay-sandbox.sepay.vn/v1/checkout/init';
}

function buildPgCheckout_(code, amount, email, site, productUrl) {
  if (!pgConfigured_()) return null;

  var desc = 'Thanh toan ' + code;
  var fields = {
    merchant: CONFIG.PG_MERCHANT_ID,
    operation: 'PURCHASE',
    payment_method: 'BANK_TRANSFER',
    order_amount: String(amount),
    currency: 'VND',
    order_invoice_number: code,
    order_description: desc.substring(0, 200),
    customer_id: email,
    success_url: productUrl + '?order=' + encodeURIComponent(code) + '&payment=success',
    error_url: site + '/payment-error.html?order=' + encodeURIComponent(code),
    cancel_url: site + '/payment-cancel.html?order=' + encodeURIComponent(code)
  };
  fields.signature = signPgFields_(fields, CONFIG.PG_SECRET_KEY);
  return {
    checkout_url: getPgCheckoutUrl_(),
    fields: fields,
    env: CONFIG.PG_ENV
  };
}

// --- Web hỏi: đơn này trả tiền chưa? ---
function checkStatus_(p) {
  var code = (p.order_code || '').trim();
  if (!code) return json_({ ok: false, error: 'missing_code' });

  var sh = getSheet_();
  var o = findOrder_(sh, code);
  if (!o) return json_({ ok: true, status: 'not_found' });

  return json_({
    ok: true,
    status: o.data[4],            // pending | paid
    product_url: o.data[4] === 'paid' ? CONFIG.PRODUCT_URL : ''
  });
}


// ===================== ENDPOINT POST =========================
// SePay bắn webhook vào đây khi có tiền về
function doPost(e) {
  // --- Xác thực bằng API Key (khuyến nghị bật trong SePay) ---
  var auth = '';
  try { auth = e.parameter && e.parameter.authorization; } catch (err) {}
  // Header thật nằm trong e.postData; Apps Script không expose header trực tiếp,
  // nên ta cũng cho phép truyền key qua query ?key= để chắc ăn.
  var keyQuery = (e && e.parameter && e.parameter.key) || '';
  if (CONFIG.SEPAY_API_KEY &&
      keyQuery !== CONFIG.SEPAY_API_KEY &&
      auth !== 'Apikey ' + CONFIG.SEPAY_API_KEY) {
    return json_({ success: false, error: 'unauthorized' });
  }

  var body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ success: false, error: 'bad_json' }); }

  // --- Cổng thanh toán SePay: IPN (màn hình Merchant ID / IPN URL) ---
  if (body.notification_type) {
    return handlePaymentGatewayIpn_(body);
  }

  // --- Webhook chuyển khoản ngân hàng (my.sepay.vn → Webhooks) ---
  if (body.transferType && body.transferType !== 'in') {
    return json_({ success: true, note: 'ignored_out' });
  }

  var content = (body.content || '') + ' ' + (body.code || '');
  var amount  = body.transferAmount || 0;
  var txId    = body.id;

  var sh = getSheet_();

  // Chống trùng: nếu tx_id này đã ghi rồi thì bỏ qua
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][7]) === String(txId)) {
      return json_({ success: true, note: 'duplicate' });
    }
  }

  // Tìm đơn pending có mã nằm trong nội dung CK VÀ trả đủ số tiền.
  // Chỉ khớp khi tiền nhận >= giá đơn (trả thiếu sẽ KHÔNG mở).
  for (var r = 1; r < values.length; r++) {
    var code   = String(values[r][0]);
    var amt    = Number(values[r][1]);
    var status = values[r][4];
    if (status === 'pending' &&
        content.toUpperCase().indexOf(code.toUpperCase()) !== -1 &&
        amount >= amt) {                 // bắt buộc đủ tiền
      var rowNum = r + 1;
      markOrderPaid_(sh, rowNum, txId, values[r][2], values[r][3], code);
      return json_({ success: true });
    }
  }

  // Trước khi kết luận "không khớp", kiểm tra xem có đơn pending đúng mã
  // nhưng khách trả THIẾU tiền không — để bạn biết mà nhắc khách bù.
  for (var r = 1; r < values.length; r++) {
    var code2   = String(values[r][0]);
    var amt2    = Number(values[r][1]);
    var status2 = values[r][4];
    if (status2 === 'pending' &&
        content.toUpperCase().indexOf(code2.toUpperCase()) !== -1 &&
        amount < amt2) {
      // Đúng đơn nhưng thiếu tiền: KHÔNG mở, ghi chú để xử lý tay.
      sh.getRange(r + 1, 5).setValue('underpaid');           // status
      sh.getRange(r + 1, 9).setValue('thieu ' + (amt2 - amount) + 'd'); // delivered col ghi chú
      return json_({ success: true, note: 'underpaid' });
    }
  }

  // Không khớp đơn nào — vẫn trả success để SePay không retry vô ích,
  // nhưng ghi lại để bạn đối soát tay.
  sh.appendRow(['(không khớp)', amount, '', '', 'unmatched',
                new Date(), new Date(), txId, '-']);
  return json_({ success: true, note: 'unmatched' });
}


// =============== IPN CỔNG THANH TOÁN SEPAY ===================
function handlePaymentGatewayIpn_(body) {
  if (body.notification_type !== 'ORDER_PAID' || !body.order) {
    return json_({ success: true });
  }

  var invoice = String(body.order.order_invoice_number || body.order.code || '');
  var amount  = parseMoney_(body.order.order_amount || body.order.amount);
  var txId    = 'pg-' + (body.order.id || body.transaction && body.transaction.id || Date.now());

  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var code   = String(values[r][0]);
    var amt    = Number(values[r][1]);
    var status = values[r][4];
    if (status !== 'pending' || !invoice) continue;

    var match = code.toUpperCase() === invoice.toUpperCase() ||
                invoice.toUpperCase().indexOf(code.toUpperCase()) !== -1;
    if (match && (amount <= 0 || amount >= amt)) {
      markOrderPaid_(sh, r + 1, txId, values[r][2], values[r][3], code);
      break;
    }
  }
  return json_({ success: true });
}


// =============== GỬI EMAIL CHUYỂN GIAO SẢN PHẨM ==============
function deliver_(email, name, code) {
  if (!email) return;
  var who = name || 'bạn';
  var subject = 'Sản phẩm của bạn đã sẵn sàng — ' + CONFIG.PRODUCT_NAME;
  var html =
    '<div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0a1f2e">' +
    '<h2 style="color:#0a1f2e">Cảm ơn ' + who + '!</h2>' +
    '<p>Thanh toán của bạn đã được xác nhận. Đây là sản phẩm của bạn:</p>' +
    '<p style="margin:24px 0"><a href="' + CONFIG.PRODUCT_URL + '" ' +
    'style="background:#ff5a3c;color:#fff;text-decoration:none;' +
    'padding:14px 26px;border-radius:10px;font-weight:bold;display:inline-block;margin-bottom:10px">' +
    'Mở kho truy cập sản phẩm</a></p>' +
    '<p style="margin:0 0 24px"><a href="' + (CONFIG.DRIVE_GIFTS || CONFIG.PRODUCT_URL) + '" ' +
    'style="background:#e8b84b;color:#0a1f2e;text-decoration:none;' +
    'padding:12px 22px;border-radius:10px;font-weight:bold">' +
    'Tải quà tặng (Google Drive)</a></p>' +
    '<p style="color:#6b7d88;font-size:13px">Mã đơn: ' + code + '<br>' +
    'Truy cập trọn đời. Sản phẩm số — <b>không hoàn tiền</b> sau khi mua.<br>' +
    'Bạn đã xác nhận đọc kỹ trước khi thanh toán.</p>' +
    '</div>';
  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: html
  });
}


// =================== HÀM TRẢ JSON ===========================
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// =================== TEST NHANH (tùy chọn) ===================
// Chạy hàm này trong editor để giả lập 1 webhook SePay, kiểm tra luồng
// mà chưa cần tiền thật. Nhớ tạo 1 đơn pending trước (qua web hoặc tay).
function _simulatePgIpn() {
  var fakeOrderCode = 'CD6XTEST01';
  var sh = getSheet_();
  if (!findOrder_(sh, fakeOrderCode)) {
    sh.appendRow([fakeOrderCode, 99000, Session.getActiveUser().getEmail(),
                  'Test User', 'pending', new Date(), '', '', 'no']);
  }
  var fakeEvent = {
    postData: { contents: JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      notification_type: 'ORDER_PAID',
      order: {
        id: 'test-order-' + Date.now(),
        order_invoice_number: fakeOrderCode,
        order_status: 'CAPTURED',
        order_amount: '99000.00',
        order_currency: 'VND'
      },
      transaction: {
        id: 'test-tx-' + Date.now(),
        payment_method: 'BANK_TRANSFER',
        transaction_status: 'APPROVED',
        transaction_amount: '99000'
      }
    })},
    parameter: { key: CONFIG.SEPAY_API_KEY }
  };
  Logger.log(doPost(fakeEvent).getContent());
}

function _simulateWebhook() {
  var fakeOrderCode = 'SCANTEST01';
  var sh = getSheet_();
  if (!findOrder_(sh, fakeOrderCode)) {
    sh.appendRow([fakeOrderCode, 99000, Session.getActiveUser().getEmail(),
                  'Test User', 'pending', new Date(), '', '', 'no']);
  }
  var fakeEvent = {
    postData: { contents: JSON.stringify({
      id: Date.now(),
      gateway: 'Vietcombank',
      transactionDate: '2026-06-16 10:00:00',
      accountNumber: CONFIG.BANK_ACCOUNT,
      content: fakeOrderCode + ' thanh toan',
      transferType: 'in',
      transferAmount: 99000
    })},
    parameter: {}
  };
  var res = doPost(fakeEvent);
  Logger.log(res.getContent());
}
