import { confirm, text, spinner, select, multiselect, isCancel } from '@clack/prompts';
import picocolors from 'picocolors';
import readline from 'readline';

export class Prompt {
  public static async askApproval(message: string): Promise<boolean> {
    const response = await confirm({
      message: `${picocolors.yellow(message)} Approve?`,
    });
    if (isCancel(response)) return false;
    return !!response;
  }

  public static async askText(message: string, initialValue?: string): Promise<string | null> {
    const response = await text({
      message,
      placeholder: 'Type your task or command...',
      initialValue,
    });
    if (isCancel(response)) return null;
    return typeof response === 'string' ? response : '';
  }

  public static async askTextWithAutocomplete(
    message: string,
    completerFn: (line: string) => [string[], string],
    promptPrefix?: string
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const promptStr = promptPrefix !== undefined
        ? promptPrefix
        : `${picocolors.cyan('?')} ${message} › `;

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: completerFn,
        prompt: promptStr,
      });

      let currentSuggestion = '';

      function updateSuggestion() {
        const line = rl.line;
        const cursor = rl.cursor;
        currentSuggestion = '';

        if (cursor === line.length && line.trim().length > 0) {
          const [hits, lastWord] = completerFn(line);
          if (hits.length > 0) {
            const bestMatch = hits[0];
            if (line.startsWith('/')) {
              if (bestMatch.startsWith(line) && bestMatch !== line) {
                currentSuggestion = bestMatch.substring(line.length);
              }
            } else if (lastWord) {
              if (bestMatch.startsWith(lastWord) && bestMatch !== lastWord) {
                currentSuggestion = bestMatch.substring(lastWord.length);
              }
            }
          }
        }

        process.stdout.write('\x1b[K'); // clear forward
        if (currentSuggestion) {
          process.stdout.write(picocolors.dim(currentSuggestion));
          readline.moveCursor(process.stdout, -currentSuggestion.length, 0);
        }
      }

      const originalTtyWrite = (rl as any)._ttyWrite;
      (rl as any)._ttyWrite = function(char: any, key: any) {
        if (currentSuggestion && key && (key.name === 'tab' || key.name === 'right')) {
          rl.write(currentSuggestion);
          currentSuggestion = '';
          process.stdout.write('\x1b[K');
          return;
        }
        originalTtyWrite.call(rl, char, key);
        updateSuggestion();
      };

      rl.prompt();

      rl.on('SIGINT', () => {
        rl.close();
        process.stdout.write('\n');
        resolve(null);
      });

      rl.on('line', (line) => {
        rl.close();
        resolve(line);
      });
    });
  }

  public static async askSelect(message: string, options: { value: string; label: string }[]): Promise<string | null> {
    const response = await select({
      message,
      options,
    });
    if (isCancel(response)) return null;
    return typeof response === 'string' ? response : '';
  }

  public static async askMultiSelect(
    message: string,
    options: { value: string; label: string; hint?: string }[]
  ): Promise<string[] | null> {
    const response = await multiselect({
      message,
      options,
      required: false,
    });
    if (isCancel(response)) return null;
    return Array.isArray(response) ? (response as string[]) : [];
  }

  public static makeSpinner() {
    return spinner();
  }
}


