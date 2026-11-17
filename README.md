# brat sticker

**brat** sticker builder for WhatsApp. Renders entirely in the browser with HTML5 Canvas; no image leaves the page.

Style is locked to measurements taken from the real meme, so there is nothing to configure: type, download.

## Run

No build step, no dependencies.

- Open `index.html` directly, or
- serve it locally so the clipboard API works:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## What it does

- Lowercase Arial Narrow regular, every line stretched to the frame width, slight blur, centered.
- Downloads PNG 512×512 (WhatsApp sticker spec), kept under ~100KB automatically.
- Copy to clipboard, share via Web Share API.
- Batch: one file per line.
- Text is saved in `localStorage`.

## Format used

The numbers below are not guesses — measured from a real brat meme sample (706×702) and the 2048×2048 album cover:

- 5% margin left/right, so text fills ~90% of the canvas width
- 5 lines fill ~87% of the canvas height, line pitch 0.18 × canvas height
- regular weight (stroke/font 0.08), not bold
- narrow glyphs: width/ascender ratio 1.588 → Arial Narrow (the alt text on the cover says "Arial Narrow")
- edge blur ~1.2% of the cover size → sigma 2.5px on a 512 canvas

## WhatsApp sticker spec

- PNG 512 × 512 px.
- After downloading, send the PNG to a WhatsApp chat → tap the image → **Sticker**.
- WhatsApp rejects stickers above ~100KB; export posters grayscale (32 → 16 → 10 levels) when the PNG is too big and stops as soon as it fits.

## Structure

```
index.html
css/style.css
js/app.js
```

`js/app.js` holds the canvas renderer: finds the largest font size that fits (binary search), wraps per word, then stretches each line to the target width — the core of the brat look.
