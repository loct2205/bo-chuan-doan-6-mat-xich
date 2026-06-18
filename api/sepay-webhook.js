/**
 * Proxy webhook SePay → Google Apps Script.
 * SePay cần HTTP 200 + {"success":true}; GAS POST thường trả 302 redirect.
 */
const GAS_WEBHOOK_URL =
  process.env.GAS_WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbzOnz00mRtqbMnSqlWFJ2lgZsAZbN5d5sEf39zL2VK1sy3FO14g0Z1JX1UsBCqszqnW0w/exec?key=cd6x_loc_2026_a8f3_dkmc_ddekl_3ttr';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  try {
    const bodyStr =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

    const gasRes = await fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      redirect: 'follow',
    });
    await gasRes.text();
  } catch (err) {
    console.error('GAS forward error:', err);
  }

  return res.status(200).json({ success: true });
};
