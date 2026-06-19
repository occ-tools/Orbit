import {
  OpenAIProvider,
  DeepSeekOpenAIProvider,
  OllamaProvider,
} from "@orbit-ai/model-providers";

function getAutocompleteProvider(providerId: string, config: any) {
  const providerConfig = config.providers?.[providerId];
  if (!providerConfig) {
    if (providerId === "ollama") {
      return new OllamaProvider();
    }
    return new DeepSeekOpenAIProvider(
      process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "no-key",
    );
  }

  const apiKey =
    providerConfig.apiKey ||
    (providerConfig.apiKeyEnv
      ? process.env[providerConfig.apiKeyEnv]
      : undefined);
  const baseUrl = providerConfig.baseUrl;

  switch (providerConfig.type) {
    case "openai":
      return new OpenAIProvider(apiKey, baseUrl);
    case "ollama":
      return new OllamaProvider(baseUrl);
    case "openai-compatible":
    case "anthropic-compatible":
    default:
      return new DeepSeekOpenAIProvider(apiKey, baseUrl);
  }
}

function safeDecodeURI(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

function getPathCommentHeader(windowId: string, cwd: string): string {
  if (!windowId || windowId === "default") {
    return "";
  }

  let filePath = windowId;
  if (filePath.startsWith("file:///")) {
    const afterScheme = safeDecodeURI(filePath.substring(8));
    if (/^[a-zA-Z]:/.test(afterScheme)) {
      filePath = afterScheme;
    } else {
      filePath = safeDecodeURI(filePath.substring(7));
    }
  } else if (filePath.startsWith("file://")) {
    filePath = safeDecodeURI(filePath.substring(7));
  }

  filePath = filePath.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/");

  let displayPath = filePath;
  if (filePath.toLowerCase().startsWith(normalizedCwd.toLowerCase() + "/")) {
    displayPath = filePath.substring(normalizedCwd.length + 1);
  } else {
    const parts = filePath.split("/");
    displayPath = parts.slice(-2).join("/");
  }

  const ext = displayPath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "py":
    case "yaml":
    case "yml":
    case "sh":
    case "rb":
    case "pl":
      return `# Path: ${displayPath}\n`;
    case "html":
    case "xml":
    case "vue":
      return `<!-- Path: ${displayPath} -->\n`;
    case "css":
    case "scss":
    case "less":
      return `/* Path: ${displayPath} */\n`;
    default:
      return `// Path: ${displayPath}\n`;
  }
}

export class AutocompleteEngine {
  private activeRequests = new Map<string, AbortController>();

  constructor(private cwd: string = process.cwd()) {}

  /**
   * Generates local FIM code autocomplete suggestions.
   */
  public async autocomplete(
    prefix: string,
    suffix: string,
    config: any,
    windowId = "default",
  ): Promise<string> {
    if (!config.autocomplete?.enabled) {
      return "";
    }

    // Debounce: Cancel previous autocomplete request for this specific window if it is still running
    const active = this.activeRequests.get(windowId);
    if (active) {
      active.abort();
    }
    const controller = new AbortController();
    this.activeRequests.set(windowId, controller);
    const signal = controller.signal;

    const providerId = config.autocomplete.provider || "ollama";
    const modelName = config.autocomplete.model || "qwen2.5-coder:1.5b";

    try {
      const provider = getAutocompleteProvider(providerId, config);
      if (typeof provider.complete !== "function") {
        return "";
      }

      // Prepend path comment header to prefix for FIM context enhancement
      const header = getPathCommentHeader(windowId, this.cwd);
      const enhancedPrefix = header ? header + prefix : prefix;

      // Detect and format FIM Prompt template based on the model name
      let fimPrompt = "";
      let stopWords: string[] = [];

      const lowercaseModel = modelName.toLowerCase();
      if (lowercaseModel.includes("deepseek")) {
        fimPrompt = `<｜fim begin｜>${enhancedPrefix}<｜fim hole｜>${suffix}<｜fim end｜>`;
        stopWords = [
          "<｜fim begin｜>",
          "<｜fim hole｜>",
          "<｜fim end｜>",
          "\n\n",
        ];
      } else {
        fimPrompt = `<fim_prefix>${enhancedPrefix}<fim_suffix>${suffix}<fim_middle>`;
        stopWords = [
          "<fim_prefix>",
          "<fim_suffix>",
          "<fim_middle>",
          "<fim_pad>",
          "<file_sep>",
          "\n\n",
        ];
      }

      const completed = await provider.complete(fimPrompt, {
        model: modelName,
        maxTokens: 64,
        stop: stopWords,
        abortSignal: signal,
      });

      return completed;
    } catch (e: any) {
      if (e.name === "AbortError" || signal.aborted) {
        // Interrupted by next request, return empty silently
        return "";
      }
      return "";
    } finally {
      if (this.activeRequests.get(windowId) === controller) {
        this.activeRequests.delete(windowId);
      }
    }
  }
}
