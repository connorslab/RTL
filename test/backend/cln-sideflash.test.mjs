import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { sideflashPayBody, postPayment } from '../../backend/controllers/cln/payments.js';

const payment = { paymentType: 'SIDEFLASH', bolt11: 'sfl1test', amount_msat: 10000000, maxfee: 100000, label: 'rtl-stable-id' };
test('Sideflash preserves exact budget and intent while excluding unrelated RPC fields', () => {
  assert.deepEqual(sideflashPayBody({ ...payment, riskfactor: 999, layers: ['untrusted'], server_pubkey: 'untrusted' }),
    { bolt11: payment.bolt11, amount_msat: 10000000, maxfee: 100000, label: 'rtl-stable-id' });
  for (const changed of [{ amount_msat: 0 }, { amount_msat: 1.5 }, { maxfee: undefined }, { maxfee: -1 }, { label: '' }, { label: 'bad/id' }, { bolt11: 'lno1test' }, { amount_msat: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => sideflashPayBody({ ...payment, ...changed }));
  }
});

test('Sideflash controller only reports completed payments as success', async () => {
  let reply = { status: 'complete', payment_hash: 'ab'.repeat(32), amount_msat: 10000000, amount_sent_msat: 10001100 };
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { seen.push({ path: req.url, body: JSON.parse(raw) }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply)); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const selectedNode = { index: 1, lnNode: 'test', lnImplementation: 'CLN', authentication: { options: { url: '', json: true, headers: {} } }, settings: { lnServerUrl: 'http://127.0.0.1:' + server.address().port, logLevel: 'ERROR' } };
  const invoke = (body) => new Promise((resolve) => {
    const result = {};
    const res = { status: (code) => { result.status = code; return res; }, json: (value) => { result.body = value; resolve(result); return res; } };
    postPayment({ session: { selectedNode }, body }, res, () => {});
  });
  try {
    assert.equal((await invoke(payment)).status, 201);
    assert.equal(seen[0].path, '/v1/pay');
    assert.deepEqual(seen[0].body, sideflashPayBody(payment));
    reply = { status: 'pending' };
    assert.equal((await invoke(payment)).status, 502);
    assert.equal(seen[1].body.label, seen[0].body.label);
    assert.equal((await invoke({ ...payment, maxfee: undefined })).status, 400);
    assert.equal(seen.length, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
