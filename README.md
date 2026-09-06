# Sanskrit Text Translator — ChatGPT UI automation

This version does **not** use the OpenAI API and does not require an API key.

It opens a visible Chromium browser using a persistent local profile, lets you sign in to ChatGPT once, and then translates the TXT **one page at a time**. Each page is sent as one single ChatGPT request.

## Run

```bash
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:3000`.

Choose the Sanskrit `.txt` file and click **Start Translation**.

The browser window opened by the translator is the ChatGPT session. Sign in there if needed. The translator then waits for the ChatGPT composer and begins page-by-page translation.

## What is visible

- total pages and units
- live page progress
- percentage progress bar
- timestamped live logs
- current page
- response size for each page
- validation result
- Stop button
- final TXT download

## Translation batching

If the source contains 41 pages, the translator sends exactly one ChatGPT request for page 1, waits for the response, validates it, then sends one request for page 2, and so on.

It does **not** split a page into 10/20/30-unit batches.

## Safety / accuracy checks

The program requires ChatGPT to return one JSON object for every supplied unit. Before a final file is accepted it checks:

- page markers preserved
- unit count preserved
- Sanskrit source unchanged
- unit order preserved
- every unit has an English translation
- verse numbers preserved in the English translation

A partial file is also written while the job runs as `.translation-<jobId>.partial.txt`.

## Important

This is UI automation of ChatGPT, not an API integration. The ChatGPT account/session remains under your control. The automation profile is stored locally in `.chatgpt-profile/`.
