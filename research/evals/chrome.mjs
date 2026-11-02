// Internal evaluation runs on the owner's Chrome locally and the pinned headless shell in browser CI.
export const evaluationChromeExecutable = process.env.PROMOBENTO_EVAL_CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
