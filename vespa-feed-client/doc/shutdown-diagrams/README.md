# Regenerate the compact diagrams

Run in this directory:

```sh
npm ci
npx playwright install chromium
npm run render
```

The renderer uses p5.js in headless Chromium to export one PNG for each entry in `cases.json`. It also generates the parent `shutdown.md` from the introduction, cases and optional closing notes. Edit those inputs, then rerun; do not edit generated Markdown separately.

Each image is 960 pixels wide. Height follows the wrapped text rather than a large fixed canvas. The two rows show the risk and the change; the status above them states any remaining limitation. The renderer checks text fit, required fields, unique IDs, PNG dimensions, local links and exact image coverage. `manifest.json` records image dimensions, hashes and the browser version.

No random values are used. Font rasterization can differ between operating systems, so cross-platform byte identity is not promised. Dependencies are pinned in the lockfile; this tooling has no runtime role in the product.
