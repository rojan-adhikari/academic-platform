# Third-party browser libraries

Vendored as plain files so the app keeps zero npm runtime dependencies.

- `qrcode-generator.js`: qrcode-generator 1.4.4 by Kazuhiko Arase, MIT License. Generates checkpoint QR codes.
- `zxing.min.js`: @zxing/library 0.21.3 (UMD build), MIT License. Reads QR codes and badge barcodes when the browser has no native BarcodeDetector.

## Map data

- `../indiamap.js`: India state/union-territory outline paths derived from [@svg-maps/india](https://github.com/VictorCazanave/svg-maps) (© Victor Cazanave), licensed **CC BY 4.0**. Coordinates were rounded to integers to keep the landing graphic lightweight. Used for the decorative map of India on the landing page.
