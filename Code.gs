/**
 * Backend Google Apps Script — SePay QR online
 * Giống my.sepay.vn/createqr (chọn "QR online"), tự sinh QR theo từng đơn.
 *
 * 1. Web gọi action=create → mã đơn + qr.sepay.vn/img
 * 2. Khách quét QR, chuyển khoản đúng nội dung
 * 3. my.sepay.vn → Webhooks → Vercel /api/sepay-webhook → GAS → paid + email
 *    (Không trỏ thẳng GAS: POST GAS trả HTTP 302, SePay coi là thất bại)
 */

// ----------------------- CONFIG -----------------------------
var CONFIG = {
  BANK_ACCOUNT : '08363636888',
  BANK_CODE    : 'TPBank',
  BANK_BIN     : '970423',   // BIN TPBank — dùng cho img.vietqr.io
  HOLDER       : 'TRAN XUAN LOC',

  // Tự đặt, gắn vào URL webhook: .../exec?key=...
  SEPAY_API_KEY: 'DOI_THANH_KEY_BAO_MAT_CUA_BAN',

  PRODUCT_NAME : 'Bộ Chẩn Đoán 6 Mắt Xích',
  PRODUCT_URL  : 'https://bo-chuan-doan-6-mat-xich.vercel.app/kho-qua.html',
  DRIVE_GIFTS  : 'https://drive.google.com/drive/folders/1RGvMJAA9Ci8OBzavx8gdoztprWGstHMG?usp=sharing',

  SHEET_NAME   : 'orders',
};
// ------------------------------------------------------------


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

function findOrder_(sh, code) {
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(code)) {
      return { row: r + 1, data: values[r] };
    }
  }
  return null;
}

function markOrderPaid_(sh, rowNum, txId, email, name, code) {
  var values = sh.getDataRange().getValues();
  var row = values[rowNum - 1];
  if (!row || row[4] === 'paid') return false;

  sh.getRange(rowNum, 5).setValue('paid');
  sh.getRange(rowNum, 7).setValue(new Date());
  sh.getRange(rowNum, 8).setValue(String(txId || 'tx-' + Date.now()));

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


function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'create') return createOrder_(p);
  if (p.action === 'status') return checkStatus_(p);
  return json_({ ok: false, error: 'unknown_action' });
}

function createOrder_(p) {
  var amount = parseInt(p.amount, 10) || 0;
  var email  = (p.email || '').trim();
  var name   = (p.name  || '').trim();
  if (amount <= 0 || !email) {
    return json_({ ok: false, error: 'missing_amount_or_email' });
  }

  var code = (p.prefix || 'DH') + Math.random().toString(36)
               .slice(2, 8).toUpperCase();

  getSheet_().appendRow([code, amount, email, name, 'pending',
                         new Date(), '', '', 'no']);

  return json_({
    ok: true,
    order_code: code,
    amount: amount,
    bank_account: CONFIG.BANK_ACCOUNT,
    bank_code: CONFIG.BANK_CODE,
    holder: CONFIG.HOLDER,
    qr_url: buildVietQrUrl_(code, amount)
  });
}

// VietQR chuẩn — qr_only: không logo SePay (docs: vietqr.io Quick Link)
function buildVietQrUrl_(code, amount) {
  var base = 'https://img.vietqr.io/image/' + CONFIG.BANK_BIN + '-' +
             CONFIG.BANK_ACCOUNT + '-qr_only.png';
  return base + '?amount=' + amount +
         '&addInfo=' + encodeURIComponent(code) +
         '&accountName=' + encodeURIComponent(CONFIG.HOLDER);
}

function checkStatus_(p) {
  var code = (p.order_code || '').trim();
  if (!code) return json_({ ok: false, error: 'missing_code' });

  var o = findOrder_(getSheet_(), code);
  if (!o) return json_({ ok: true, status: 'not_found' });

  return json_({
    ok: true,
    status: o.data[4],
    product_url: o.data[4] === 'paid' ? CONFIG.PRODUCT_URL : ''
  });
}


function doPost(e) {
  var keyQuery = (e && e.parameter && e.parameter.key) || '';
  if (CONFIG.SEPAY_API_KEY &&
      keyQuery !== CONFIG.SEPAY_API_KEY) {
    return json_({ success: false, error: 'unauthorized' });
  }

  var body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ success: false, error: 'bad_json' }); }

  if (body.transferType && body.transferType !== 'in') {
    return json_({ success: true, note: 'ignored_out' });
  }

  var content = (body.content || '') + ' ' + (body.code || '');
  var amount  = body.transferAmount || 0;
  var txId    = body.id;
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][7]) === String(txId)) {
      return json_({ success: true, note: 'duplicate' });
    }
  }

  for (var r = 1; r < values.length; r++) {
    var code   = String(values[r][0]);
    var amt    = Number(values[r][1]);
    var status = values[r][4];
    if (status === 'pending' &&
        content.toUpperCase().indexOf(code.toUpperCase()) !== -1 &&
        amount >= amt) {
      markOrderPaid_(sh, r + 1, txId, values[r][2], values[r][3], code);
      return json_({ success: true });
    }
  }

  for (var r = 1; r < values.length; r++) {
    var code2   = String(values[r][0]);
    var amt2    = Number(values[r][1]);
    var status2 = values[r][4];
    if (status2 === 'pending' &&
        content.toUpperCase().indexOf(code2.toUpperCase()) !== -1 &&
        amount < amt2) {
      sh.getRange(r + 1, 5).setValue('underpaid');
      sh.getRange(r + 1, 9).setValue('thieu ' + (amt2 - amount) + 'd');
      return json_({ success: true, note: 'underpaid' });
    }
  }

  sh.appendRow(['(không khớp)', amount, '', '', 'unmatched',
                new Date(), new Date(), txId, '-']);
  return json_({ success: true, note: 'unmatched' });
}


function deliver_(email, name, code) {
  if (!email) return;
  var who = name || 'bạn';
  var html =
    '<div style="font-family:sans-serif;max-width:520px;margin:auto;color:#0a1f2e">' +
    '<h2 style="color:#0a1f2e">Cảm ơn ' + who + '!</h2>' +
    '<p>Thanh toán của bạn đã được xác nhận. Đây là sản phẩm của bạn:</p>' +
    '<p style="margin:24px 0"><a href="' + CONFIG.PRODUCT_URL + '" ' +
    'style="background:#ff5a3c;color:#fff;text-decoration:none;' +
    'padding:14px 26px;border-radius:10px;font-weight:bold;display:inline-block">' +
    'Mở kho truy cập sản phẩm</a></p>' +
    '<p style="margin:0 0 24px"><a href="' + CONFIG.DRIVE_GIFTS + '" ' +
    'style="background:#e8b84b;color:#0a1f2e;text-decoration:none;' +
    'padding:12px 22px;border-radius:10px;font-weight:bold">' +
    'Tải quà tặng (Google Drive)</a></p>' +
    '<p style="color:#6b7d88;font-size:13px">Mã đơn: ' + code + '</p>' +
    '</div>';
  MailApp.sendEmail({
    to: email,
    subject: 'Sản phẩm của bạn đã sẵn sàng — ' + CONFIG.PRODUCT_NAME,
    htmlBody: html
  });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


function _simulateWebhook() {
  var code = 'DHTEST01';
  var sh = getSheet_();
  if (!findOrder_(sh, code)) {
    sh.appendRow([code, 99000, Session.getActiveUser().getEmail(),
                  'Test', 'pending', new Date(), '', '', 'no']);
  }
  Logger.log(doPost({
    postData: { contents: JSON.stringify({
      id: Date.now(),
      content: code + ' thanh toan',
      transferType: 'in',
      transferAmount: 99000
    })},
    parameter: { key: CONFIG.SEPAY_API_KEY }
  }).getContent());
}
