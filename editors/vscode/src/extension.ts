import * as http from "http";
import * as vscode from "vscode";
import { z } from "zod";

const AutocompleteEndpointSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32).max(256),
});

type AutocompleteEndpoint = z.infer<typeof AutocompleteEndpointSchema>;

export function activate(context: vscode.ExtensionContext): void {
  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      _context: vscode.InlineCompletionContext,
      cancellation: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[]> {
      if (cancellation.isCancellationRequested) return [];

      const endpoint = await readAutocompleteEndpoint(document.uri);
      if (!endpoint) return [];
      const offset = document.offsetAt(position);
      const text = document.getText();
      const prefix = text.substring(Math.max(0, offset - 3000), offset);
      const suffix = text.substring(
        offset,
        Math.min(text.length, offset + 3000),
      );

      const completionText = await fetchAutocomplete(
        prefix,
        suffix,
        document.uri.toString(),
        endpoint,
        cancellation,
      );
      if (!completionText || cancellation.isCancellationRequested) return [];

      return [
        new vscode.InlineCompletionItem(
          completionText,
          new vscode.Range(position, position),
        ),
      ];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      provider,
    ),
  );
}

async function readAutocompleteEndpoint(
  documentUri: vscode.Uri,
): Promise<AutocompleteEndpoint | undefined> {
  const workspace = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!workspace) return undefined;
  try {
    const endpointUri = vscode.Uri.joinPath(
      workspace.uri,
      ".orbit",
      "autocomplete.json",
    );
    const raw = await vscode.workspace.fs.readFile(endpointUri);
    const parsed = AutocompleteEndpointSchema.safeParse(
      JSON.parse(Buffer.from(raw).toString("utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function fetchAutocomplete(
  prefix: string,
  suffix: string,
  windowId: string,
  endpoint: AutocompleteEndpoint,
  cancellation: vscode.CancellationToken,
): Promise<string> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ prefix, suffix, windowId });
    let settled = false;
    let cancellationSubscription: vscode.Disposable = { dispose() {} };
    const complete = (value: string) => {
      if (settled) return;
      settled = true;
      cancellationSubscription.dispose();
      resolve(value);
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: endpoint.port,
        path: "/autocomplete",
        method: "POST",
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 1500,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        res.on("end", () => {
          if (res.statusCode !== 200) return complete("");
          try {
            const parsed = JSON.parse(body) as { completion?: unknown };
            complete(
              typeof parsed.completion === "string" ? parsed.completion : "",
            );
          } catch {
            complete("");
          }
        });
      },
    );
    cancellationSubscription = cancellation.onCancellationRequested(() => {
      req.destroy();
      complete("");
    });
    req.on("error", () => complete(""));
    req.on("timeout", () => {
      req.destroy();
      complete("");
    });
    req.write(postData);
    req.end();
  });
}

export function deactivate(): void {}
