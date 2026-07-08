# Shipping history seed

`history.sqlite3.gz.enc` is an encrypted, compressed copy of the sanitized
shipping-management history database.

The decryption passphrase is stored in the GitHub Actions secret
`SHIPPING_HISTORY_SEED_PASSPHRASE`, not in this repository. During deployment,
`deploy/install-shipping-history-seed.sh` decrypts it into:

`/opt/rr-portal/apps/船务部/船务管理系统/data/import/history.sqlite3`

The app startup then imports that private SQLite file only when the live
shipping database has no business rows.

Do not commit plaintext `history.sqlite3` or `history.sqlite3.gz`.
