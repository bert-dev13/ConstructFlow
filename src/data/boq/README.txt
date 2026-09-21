BOQ catalog for SWA item-number auto-fill
============================================

Source PDF:  itemno.pdf  (items start on page 3)

Generated catalog:  catalog.json  (3,248+ DPWH pay items)

To rebuild catalog.json after updating the PDF:
  python scripts/extract_boq_pdf.py
  npm run build

In SWA, type an item number (e.g. B.7 (1), A.1.1 (11), 311 (1) c1)
and press Tab or click away — description and unit auto-fill.

Unit price and quantity are NOT in the PDF catalog; enter those manually
or they will load from the road-project reference rows when item numbers match.
