import readline from "readline";

/** Displays long text one terminal page at a time. */
export async function pageText(text: string): Promise<void> {
  const lines = text.split("\n");
  const rows = process.stdout.rows || 24;
  const pageSize = Math.max(1, rows - 2);

  if (lines.length <= pageSize) {
    console.log(text);
    return;
  }

  let cursor = 0;
  const wasRaw = Boolean(process.stdin.isRaw);
  if (process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);

  const waitForKeypress = (): Promise<string> =>
    new Promise((resolve) => {
      const onKeypress = (str: string, key: readline.Key) => {
        process.stdin.removeListener("keypress", onKeypress);
        if (key?.ctrl && key.name === "c") {
          if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw);
          process.exit(0);
        }
        resolve(key?.name || str);
      };
      process.stdin.on("keypress", onKeypress);
    });

  try {
    while (cursor < lines.length) {
      console.log(lines.slice(cursor, cursor + pageSize).join("\n"));
      cursor += pageSize;
      if (cursor >= lines.length) break;

      process.stdout.write(
        `\r\x1b[36m-- More (${Math.round((cursor / lines.length) * 100)}%) [Space/Enter to continue, q to quit] --\x1b[39m`,
      );
      const key = await waitForKeypress();
      process.stdout.write("\r\x1b[K");
      if (key === "q") break;
      if (key === "return" || key === "enter") {
        cursor = cursor - pageSize + 1;
      }
    }
  } finally {
    if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  }
}
