# Simple PDF Text Editor

A lightweight browser-based PDF text editor built with HTML, CSS, and JavaScript.

## Features

- Upload any text-based PDF
- Drag and drop a PDF anywhere on the page to upload quickly
- Edit detected text directly on top of each page
- Add pictures on any page, then drag/resize/remove them
- Draw signature, place it on any page, then drag/resize/remove it
- Keeps text position, size, and font family style as close as possible
- Attempts to preserve original text and background color
- Download edited PDF to your device

## Run

Open `index.html` directly in your browser, or run a simple local server:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Notes

- Works best with text-based PDFs (not scanned images).
- Complex embedded/custom fonts may be approximated with the closest standard PDF font on export.
- Color/background matching is estimated from the rendered page for easier visual replacement.
- Existing images inside the original PDF are not directly editable; you can overlay new/replacement images.
