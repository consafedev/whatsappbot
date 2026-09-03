import { describe, expect, it } from "vitest";
import { cosineSimilarity, rankChunksBySimilarity } from "./vector-math";

describe("Vector Math Unit Tests", () => {
  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
      const v1 = [1, 2, 3];
      const v2 = [1, 2, 3];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    });

    it("returns -1.0 for opposite vectors", () => {
      const v1 = [1, 2, 3];
      const v2 = [-1, -2, -3];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
    });

    it("returns 0.0 for orthogonal vectors", () => {
      const v1 = [1, 0];
      const v2 = [0, 1];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
    });

    it("returns 0.0 for empty or mismatched length vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0.0);
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0.0);
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0.0);
    });
  });

  describe("rankChunksBySimilarity", () => {
    it("ranks and filters chunks by minScore and topK", () => {
      const query = [1, 0, 0];
      const chunks = [
        { id: "c1", embedding: [1, 0, 0], content: "Exact match" }, // sim 1.0
        { id: "c2", embedding: [0.8, 0.6, 0], content: "High similarity" }, // sim 0.8
        { id: "c3", embedding: [0.3, 0.9, 0], content: "Low similarity" }, // sim 0.3
        { id: "c4", embedding: null, content: "No embedding" },
      ];

      const results = rankChunksBySimilarity(query, chunks, {
        minScore: 0.5,
        topK: 2,
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("c1");
      expect(results[0]?.score).toBe(1.0);
      expect(results[1]?.id).toBe("c2");
      expect(results[1]?.score).toBeCloseTo(0.8, 2);
    });

    it("returns empty array when no chunks meet minScore", () => {
      const query = [1, 0, 0];
      const chunks = [{ id: "c1", embedding: [0, 1, 0], content: "Orthogonal" }];

      const results = rankChunksBySimilarity(query, chunks, { minScore: 0.5 });
      expect(results).toEqual([]);
    });
  });
});
