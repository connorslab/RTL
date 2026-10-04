# Sideflash for CLN (experimental)

This branch adds a Sideflash option to Lightning > Transactions > Send Payment.
It uses CLN's normal decode and pay RPCs with the Sideflash plugin installed.
CLN checks the embedded signatures, network, expiry, and configured server pin,
then negotiates and pays a BOLT12 invoice. No resolver is needed.

Configure sideflash-server-pubkey with the ASP's independently verified full
compressed key. This first test integration supports one configured ASP pin.
Private-channel test deployments may also configure sideflash-routing-layer.
LND and Eclair Sideflash payments are not implemented by this branch.

Enter an address, whole-sat amount and explicit maximum routing fee. Verify the
address, review the displayed server key and expiry, then press Send Payment.
The browser saves the payment label before submitting. After a lost response,
retry with the same address, amount, fee and selected node; keep browser storage
until the payment is reconciled. Changing those fields creates another intent.
Do not clear storage or switch browsers to retry an uncertain payment.

The backend forwards only the authorized destination, amount, fee cap and label.
It only reports success when CLN returns status: complete. Lightning settlement
does not prove the receiving wallet has claimed an Ark output; confirm delivery
with the recipient. Recovery allocations and recipient ASP fees are separate from
the routing cap.

Validation includes fee/amount/input rejection, stale address-preview handling,
stable retry IDs, backend complete-versus-pending responses, and isolated CLN
regtest payments. Normal BOLT11, offer and keysend workflows remain available.
