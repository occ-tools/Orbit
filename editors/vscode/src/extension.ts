import * as vscode from 'vscode';
import * as http from 'http';

export function activate(context: vscode.ExtensionContext) {
  console.log('Orbit Autocomplete Extension is now active!');

  // Register inline completions provider for all documents
  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.InlineCompletionContext,
      token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[]> {
      
      // Don't trigger if cancelled
      if (token.isCancellationRequested) {
        return [];
      }

      // Fetch prefix (up to 3000 chars before cursor) and suffix (up to 3000 chars after cursor)
      const offset = document.offsetAt(position);
      const text = document.getText();
      
      const prefix = text.substring(Math.max(0, offset - 3000), offset);
      const suffix = text.substring(offset, Math.min(text.length, offset + 3000));

      try {
        const completionText = await fetchAutocomplete(prefix, suffix);
        if (!completionText) {
          return [];
        }

        const completionItem = new vscode.InlineCompletionItem(
          completionText,
          new vscode.Range(position, position)
        );

        return [completionItem];
      } catch (err) {
        // Fail silently to avoid UI alerts on keystrokes
        return [];
      }
    }
  };

  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );

  context.subscriptions.push(disposable);
}

function fetchAutocomplete(prefix: string, suffix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ prefix, suffix });

    // Port 6018 is the default Orbit Autocomplete bridge port
    const options = {
      hostname: '127.0.0.1',
      port: 6018,
      path: '/autocomplete',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 1500, // Quick timeout for fluid typing experience
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.completion || '');
          } catch {
            resolve('');
          }
        } else {
          resolve('');
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });

    req.write(postData);
    req.end();
  });
}

export function deactivate() {}
