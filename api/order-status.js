/**
 * Proxy kiểm tra trạng thái đơn → GAS (tránh 302 chậm + cache trên trình duyệt).
 */
const GAS_API_URL =
  process.env.GAS_API_URL ||
  'https://script.google.com/macros/s/AKfycbzOnz00mRtqbMnSqlWFJ2lgZsAZbN5d5sEf39zL2VK1sy3FO14g0Z1JX1UsBCqszqnW0w/exec';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const orderCode = req.query.order_code || req.query.code;
  if (!orderCode) {
    return res.status(400).json({ ok: false, error: 'missing_code' });
  }

  try {
    const gasUrl =
      GAS_API_URL +
      '?action=status&order_code=' +
      encodeURIComponent(String(orderCode)) +
      '&_=' +
      Date.now();

    const gasRes = await fetch(gasUrl, { redirect: 'follow', cache: 'no-store' });
    const data = JSON.parse(await gasRes.text());
    return res.status(200).json(data);
  } catch (err) {
    console.error('order-status error:', err);
    return res.status(502).json({ ok: false, error: 'gas_unavailable' });
  }
};
