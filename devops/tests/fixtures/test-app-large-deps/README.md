# test-app-large-deps

Test fixture for OOM handling during Docker builds.

This app has a large number of heavy dependencies (AWS SDK, Puppeteer, Sharp,
Playwright, TensorFlow, etc.) that collectively stress memory during
`npm install`. The QC pipeline should detect this and apply the
`--max-old-space-size` flag or split the install into stages to avoid OOM
kills on servers with 4GB RAM or less.

The dependencies are listed in package.json but are never actually installed
in this fixture — only the manifest matters for testing detection logic.
