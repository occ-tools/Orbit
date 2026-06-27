import { describe, it, expect } from "vitest";
import { JSVectorStore, Document } from "./VectorStore.js";
import { BM25Store, tokenize } from "./BM25.js";
import { HybridSearch } from "./HybridSearch.js";
import { ASTChunker } from "./ASTChunker.js";
import { join } from "path";

describe("RAG Core Engine Tests", () => {
  const tempCwd = "./rag-test-temp";

  describe("Tokenizer & BM25 Store", () => {
    it("should tokenize identifiers correctly and remove keywords", () => {
      const text = "const myAwesomeVariable = calculateTotal_amount(100);";
      const tokens = tokenize(text);
      expect(tokens).toContain("my");
      expect(tokens).toContain("awesome");
      expect(tokens).toContain("variable");
      expect(tokens).toContain("calculate");
      expect(tokens).toContain("total");
      expect(tokens).toContain("amount");
      expect(tokens).not.toContain("const"); // Keyword removed
    });

    it("should store and retrieve BM25 records correctly", async () => {
      const store = new BM25Store(join(tempCwd, "bm25"));
      await store.clear();

      const doc1: Document = {
        id: "doc1",
        text: "implement alternate screen buffer initialization",
        metadata: { filePath: "src/tui.ts", startLine: 1, endLine: 10 },
      };
      const doc2: Document = {
        id: "doc2",
        text: "unhandled exception rejection handler error",
        metadata: { filePath: "src/errors.ts", startLine: 1, endLine: 10 },
      };

      await store.addDocuments([doc1, doc2]);

      const searchRes = await store.search("buffer initialization", 2);
      expect(searchRes.length).toBe(1);
      expect(searchRes[0].id).toBe("doc1");
      expect(searchRes[0].score).toBeGreaterThan(0);

      // Verify delete functionality
      await store.deleteByFilePath("src/tui.ts");
      const searchResAfterDelete = await store.search(
        "buffer initialization",
        2,
      );
      expect(searchResAfterDelete.length).toBe(0);
    });
  });

  describe("Vector Store (JSVectorStore)", () => {
    it("should compute Cosine Similarity accurately and retrieve docs", async () => {
      const store = new JSVectorStore(join(tempCwd, "vector"));
      await store.clear();

      const doc1: Document = {
        id: "docA",
        text: "hello world",
        vector: [1.0, 0.0, 0.0],
        metadata: { filePath: "a.ts", startLine: 1, endLine: 5 },
      };
      const doc2: Document = {
        id: "docB",
        text: "hello universe",
        vector: [0.0, 1.0, 0.0],
        metadata: { filePath: "b.ts", startLine: 1, endLine: 5 },
      };

      await store.addDocuments([doc1, doc2]);

      const queryVector = [1.0, 0.1, 0.0];
      const results = await store.search(queryVector, 2);

      expect(results.length).toBe(2);
      expect(results[0].id).toBe("docA"); // docA has higher cosine similarity
      expect(results[0].score).toBeCloseTo(0.995, 2);
      expect(results[1].id).toBe("docB");
      expect(results[1].score).toBeCloseTo(0.099, 2);
    });
  });

  describe("AST Chunker", () => {
    it("should split file contents based on symbol line boundaries", () => {
      const content = `// Line 1: Header
// Line 2: Import
import fs from 'fs';

export class Helper {
  // line 6
  run() {}
}

export function test() {
  return 123;
}
`;
      const symbols = [
        { name: "Helper", type: "class" as const, line: 5 },
        { name: "test", type: "function" as const, line: 10 },
      ];

      const chunks = ASTChunker.chunkFile(content, "test.ts", symbols);

      expect(chunks.length).toBe(3); // Header, Helper class, test function

      // Check Header Chunk
      expect(chunks[0].metadata.symbolType).toBe("file_header");
      expect(chunks[0].metadata.startLine).toBe(1);
      expect(chunks[0].metadata.endLine).toBe(4);

      // Check Helper class chunk
      expect(chunks[1].metadata.symbolName).toBe("Helper");
      expect(chunks[1].metadata.symbolType).toBe("class");
      expect(chunks[1].metadata.startLine).toBe(5);
      expect(chunks[1].metadata.endLine).toBe(9);

      // Check test function chunk
      expect(chunks[2].metadata.symbolName).toBe("test");
      expect(chunks[2].metadata.symbolType).toBe("function");
      expect(chunks[2].metadata.startLine).toBe(10);
      expect(chunks[2].metadata.endLine).toBe(13);
    });
  });

  describe("Hybrid Search (RRF)", () => {
    it("should perform Reciprocal Rank Fusion of vector and BM25 results", async () => {
      const hs = new HybridSearch(join(tempCwd, "hybrid"));
      await hs.clear();

      const doc1: Document = {
        id: "1",
        text: "active alternative buffer initialization",
        vector: [1.0, 0.0],
        metadata: { filePath: "tui.ts", startLine: 1, endLine: 5 },
      };
      const doc2: Document = {
        id: "2",
        text: "error handlers throw errors",
        vector: [0.0, 1.0],
        metadata: { filePath: "errors.ts", startLine: 1, endLine: 5 },
      };

      await hs.addDocuments([doc1, doc2]);

      const mockEmbedFn = async (_texts: string[]) => {
        // Query "buffer" matches doc1 vector
        return [[0.95, 0.05]];
      };

      const results = await hs.search("buffer initialization", mockEmbedFn, {
        limit: 2,
      });

      expect(results.length).toBe(2);
      expect(results[0].id).toBe("1");
      expect(results[0].hybridScore).toBeGreaterThan(results[1].hybridScore);
    });
  });

  describe("ReferencesRetriever", () => {
    it("should scan symbol index and extract context from reference call sites", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const orbitDir = path.join(tempCwd, ".orbit");
      if (!fs.existsSync(orbitDir)) {
        fs.mkdirSync(orbitDir, { recursive: true });
      }

      // 1. Mock symbols.json
      const indexData = {
        files: {
          "src/caller.ts": {
            symbols: [],
          },
        },
      };
      fs.writeFileSync(
        path.join(orbitDir, "symbols.json"),
        JSON.stringify(indexData),
        "utf8",
      );

      // 2. Mock caller.ts file
      const callerContent = `// First line
import { myTestSymbol } from "./lib";

export function exec() {
  console.log("Starting execution...");
  myTestSymbol("hello"); // Call site!
  console.log("Completed execution.");
}
`;
      const srcDir = path.join(tempCwd, "src");
      if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(tempCwd, "src/caller.ts"),
        callerContent,
        "utf8",
      );

      const { ReferencesRetriever } = await import("./ReferencesRetriever.js");
      const retriever = new ReferencesRetriever(tempCwd);
      const output = await retriever.getReferencesContext(["myTestSymbol"]);

      expect(output).toContain("Symbol Call References");
      expect(output).toContain("src/caller.ts");
      expect(output).toContain('myTestSymbol("hello");');

      // Cleanup
      try {
        fs.unlinkSync(path.join(tempCwd, "src/caller.ts"));
        fs.unlinkSync(path.join(orbitDir, "symbols.json"));
      } catch {
        // ignore
      }
    });

    it("should handle regex special characters in symbol name safely", async () => {
      const fs = await import("fs");
      const path = await import("path");

      const orbitDir = path.join(tempCwd, ".orbit");
      if (!fs.existsSync(orbitDir)) {
        fs.mkdirSync(orbitDir, { recursive: true });
      }

      const indexData = {
        files: {
          "src/caller.ts": {
            symbols: [],
          },
        },
      };
      fs.writeFileSync(
        path.join(orbitDir, "symbols.json"),
        JSON.stringify(indexData),
        "utf8",
      );

      const callerContent = `
import { List } from "./lib";
const a = new List<string>();
`;
      const srcDir = path.join(tempCwd, "src");
      if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(tempCwd, "src/caller.ts"),
        callerContent,
        "utf8",
      );

      const { ReferencesRetriever } = await import("./ReferencesRetriever.js");
      const retriever = new ReferencesRetriever(tempCwd);

      // Symbol names containing regex special characters
      const outputSpecial = await retriever.getReferencesContext(["List<string>"]);
      expect(outputSpecial).toContain("src/caller.ts");
      expect(outputSpecial).toContain("new List<string>()");

      // Symbol names that are invalid regex entirely
      const outputMalformed = await retriever.getReferencesContext(["List["]);
      expect(outputMalformed).toBe("");

      // Cleanup
      try {
        fs.unlinkSync(path.join(tempCwd, "src/caller.ts"));
        fs.unlinkSync(path.join(orbitDir, "symbols.json"));
      } catch {
        // ignore
      }
    });
  });

  describe("Vector Store DBAdaptability", () => {
    it("should handle embedding model name and dimension changes resiliently", async () => {
      const fs = await import("fs");
      const storePath = join(tempCwd, "vector_adapt");

      // 1. Write documents with Model A (dimension 3)
      const storeA = new JSVectorStore(storePath, "model-A");
      await storeA.clear();

      const doc: Document = {
        id: "doc1",
        text: "test document",
        vector: [1.0, 0.0, 0.0],
        metadata: { filePath: "test.ts", startLine: 1, endLine: 2 },
      };
      await storeA.addDocuments([doc]);

      // Verify header is written
      const dbFile = join(storePath, ".orbit", "vector_store.json");
      expect(fs.existsSync(dbFile)).toBe(true);
      const raw = fs.readFileSync(dbFile, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.header.modelName).toBe("model-A");
      expect(parsed.header.dimension).toBe(3);

      // 2. Load with Model B (dimension change detection)
      const storeB = new JSVectorStore(storePath, "model-B");
      await storeB.load();

      // Mismatch should have wiped the DB
      const searchRes = await storeB.search([1.0, 0.0, 0.0], 2);
      expect(searchRes.length).toBe(0);

      // 3. Search with dimension mismatch
      const storeC = new JSVectorStore(storePath, "model-C");
      const doc2: Document = {
        id: "doc2",
        text: "test C",
        vector: [1.0, 0.0, 0.0],
        metadata: { filePath: "c.ts", startLine: 1, endLine: 2 },
      };
      await storeC.addDocuments([doc2]);

      // Mismatch query vector dimension (2 instead of 3)
      const searchResDimMismatch = await storeC.search([1.0, 0.0], 2);
      expect(searchResDimMismatch.length).toBe(0);
    });
  });
});
