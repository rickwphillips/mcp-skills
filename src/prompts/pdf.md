
# PDF Processing Guide

Prefer the MCP `pdf_*` tools when they cover the operation:

- `pdf_merge` — combine multiple PDFs in order
- `pdf_split` — split by page ranges into multiple outputs
- `pdf_extract_text` — page-by-page text extraction
- `pdf_rotate` — rotate pages by 90/180/270
- `pdf_watermark` — diagonal text watermark across all pages
- `pdf_encrypt` — currently a stub (saves without password); real encryption coming via qpdf
- `pdf_decrypt` — re-save without password (no validation)

For everything else (tables, OCR, form filling, advanced creation), fall back to Python or shell tools.

## Quick Start (fallback)

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python Libraries

### pypdf — Basic Operations

```python
# Merge
from pypdf import PdfWriter, PdfReader
writer = PdfWriter()
for f in ["doc1.pdf", "doc2.pdf"]:
    for page in PdfReader(f).pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as out:
    writer.write(out)

# Split (one page per file)
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    w = PdfWriter()
    w.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as out:
        w.write(out)

# Metadata
meta = PdfReader("document.pdf").metadata
print(meta.title, meta.author, meta.subject, meta.creator)

# Rotate
page = PdfReader("input.pdf").pages[0]
page.rotate(90)
```

### pdfplumber — Text and Tables

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        print(page.extract_text())

# Tables
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        for j, table in enumerate(page.extract_tables()):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

### reportlab — Create PDFs

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
w, h = letter
c.drawString(100, h - 100, "Hello World!")
c.save()
```

**IMPORTANT — never use Unicode subscript/superscript characters** (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts don't include those glyphs and they render as solid black boxes. Use ReportLab XML markup instead:

```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet
styles = getSampleStyleSheet()
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])
squared  = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), adjust font size and position manually.

## Command-Line Tools

### pdftotext (poppler-utils)
```bash
pdftotext input.pdf output.txt
pdftotext -layout input.pdf output.txt
pdftotext -f 1 -l 5 input.pdf output.txt
```

### qpdf
```bash
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf output.pdf --rotate=+90:1
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk
```bash
pdftk file1.pdf file2.pdf cat output merged.pdf
pdftk input.pdf burst
pdftk input.pdf rotate 1east output rotated.pdf
```

## Common Tasks (fallback)

### OCR scanned PDFs
```python
import pytesseract
from pdf2image import convert_from_path

images = convert_from_path('scanned.pdf')
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n" + pytesseract.image_to_string(image) + "\n\n"
```

### Watermark via pypdf (when pdf_watermark won't fit)
```python
from pypdf import PdfReader, PdfWriter
watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("document.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
with open("watermarked.pdf", "wb") as out:
    writer.write(out)
```

### Extract images
```bash
pdfimages -j input.pdf output_prefix
```

### Password protection (real, via pypdf)
```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.encrypt("userpassword", "ownerpassword")
with open("encrypted.pdf", "wb") as out:
    writer.write(out)
```

## Quick Reference

| Task | First choice | Fallback |
|------|--------------|----------|
| Merge | `pdf_merge` | pypdf / qpdf |
| Split | `pdf_split` | pypdf / qpdf |
| Extract text | `pdf_extract_text` | pdfplumber / pdftotext |
| Extract tables | pdfplumber | (no MCP tool) |
| Create PDF | reportlab | (no MCP tool) |
| Rotate | `pdf_rotate` | qpdf / pypdf |
| Watermark | `pdf_watermark` | pypdf |
| Encrypt (real) | pypdf | qpdf |
| Decrypt | `pdf_decrypt` (no validation) or qpdf | |
| OCR | pytesseract + pdf2image | (no MCP tool) |
| Form fill | pdf-lib / pypdf | (see FORMS.md if present) |
