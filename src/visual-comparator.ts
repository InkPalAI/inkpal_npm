/**
 * ImageComparator — pixel-level PNG comparison using pixelmatch
 *
 * Compares two PNG screenshots and generates a diff image + similarity score.
 * Used by VisualTestRunner for regression detection.
 *
 * @module engines/visual-test/ImageComparator
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ComparisonResult {
  /** 0.0 (completely different) to 1.0 (identical) */
  similarity: number;
  /** Total pixels in the image */
  totalPixels: number;
  /** Number of differing pixels */
  differingPixels: number;
  /** Path to generated diff image (if outputDiffPath provided) */
  diffImagePath?: string;
  /** Whether dimensions matched */
  dimensionsMatch: boolean;
  /** Baseline dimensions */
  baselineDimensions: { width: number; height: number };
  /** Current dimensions */
  currentDimensions: { width: number; height: number };
  /** HiDPI scale mismatch detected (one image is ~2x the other) */
  hiDpiMismatch?: boolean;
  /** Hint when HiDPI mismatch detected */
  hiDpiHint?: string;
}

export interface CompareOptions {
  /** Pixelmatch threshold (0-1, lower = stricter). Default: 0.1 */
  threshold?: number;
  /** Include anti-aliasing detection. Default: true */
  includeAA?: boolean;
  /** Alpha channel threshold. Default: 0.1 */
  alpha?: number;
  /** Path to write the diff PNG */
  outputDiffPath?: string;
}

/**
 * Compare two PNG files pixel-by-pixel.
 * Falls back to buffer equality if pixelmatch is not installed.
 */
export async function compare(
  baselinePath: string,
  currentPath: string,
  options: CompareOptions = {},
): Promise<ComparisonResult> {
  const { threshold = 0.1, includeAA = true, alpha = 0.1, outputDiffPath } = options;

  // Try loading pixelmatch + pngjs (optional deps — dynamic import to avoid TS resolution)
  let pixelmatch: (img1: Uint8Array, img2: Uint8Array, output: Uint8Array | null, width: number, height: number, options?: Record<string, unknown>) => number;
  let PNG: { sync: { read: (buf: Buffer) => { width: number; height: number; data: Buffer }; write: (png: { width: number; height: number; data: Buffer }) => Buffer }; new(opts: { width: number; height: number }): { data: Buffer; width: number; height: number } };

  try {
    const pm = await (Function('return import("pixelmatch")')() as Promise<{ default: typeof pixelmatch }>);
    pixelmatch = pm.default;
    const pngjs = await (Function('return import("pngjs")')() as Promise<{ PNG: typeof PNG }>);
    PNG = pngjs.PNG;
  } catch {
    // Fallback: buffer equality comparison
    return bufferCompare(baselinePath, currentPath);
  }

  const baselineBuf = readFileSync(baselinePath);
  const currentBuf = readFileSync(currentPath);

  const baselineImg = PNG.sync.read(baselineBuf);
  const currentImg = PNG.sync.read(currentBuf);

  const baseW = baselineImg.width;
  const baseH = baselineImg.height;
  const curW = currentImg.width;
  const curH = currentImg.height;

  // Handle dimension mismatch: use the larger dimensions
  const width = Math.max(baseW, curW);
  const height = Math.max(baseH, curH);
  const dimensionsMatch = baseW === curW && baseH === curH;

  // Pad images to same size if needed
  const baselineData = padImage(baselineImg.data, baseW, baseH, width, height);
  const currentData = padImage(currentImg.data, curW, curH, width, height);

  const diffData = new Uint8Array(width * height * 4);

  const differingPixels = pixelmatch(
    baselineData,
    currentData,
    diffData,
    width,
    height,
    { threshold, includeAA, alpha },
  );

  const totalPixels = width * height;
  const similarity = 1 - differingPixels / totalPixels;

  let diffImagePath: string | undefined;
  if (outputDiffPath) {
    const diffPng = new PNG({ width, height });
    diffPng.data = Buffer.from(diffData);
    const diffBuffer = PNG.sync.write(diffPng);
    mkdirSync(dirname(outputDiffPath), { recursive: true });
    writeFileSync(outputDiffPath, diffBuffer);
    diffImagePath = outputDiffPath;
  }

  // Detect HiDPI scale mismatch: one image is ~2x the other in both dimensions
  const scaleW = curW > 0 ? baseW / curW : 1;
  const scaleH = curH > 0 ? baseH / curH : 1;
  const hiDpiMismatch = !dimensionsMatch &&
    Math.abs(scaleW - 2) < 0.1 && Math.abs(scaleH - 2) < 0.1;

  return {
    similarity,
    totalPixels,
    differingPixels,
    diffImagePath,
    dimensionsMatch,
    baselineDimensions: { width: baseW, height: baseH },
    currentDimensions: { width: curW, height: curH },
    ...(hiDpiMismatch ? {
      hiDpiMismatch: true,
      hiDpiHint: `Baseline is ${baseW}×${baseH}, current is ${curW}×${curH} (2x scale). Re-capture the baseline on the same device/scale for accurate comparison.`,
    } : {}),
  };
}

/**
 * Pad an RGBA image buffer to target dimensions (transparent padding).
 */
function padImage(
  data: Buffer | Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): Uint8Array {
  if (srcW === targetW && srcH === targetH) {
    return new Uint8Array(data);
  }

  const padded = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < srcH; y++) {
    const srcOffset = y * srcW * 4;
    const dstOffset = y * targetW * 4;
    padded.set(data.slice(srcOffset, srcOffset + srcW * 4), dstOffset);
  }
  return padded;
}

/**
 * Fallback: simple buffer equality when pixelmatch is not available.
 */
function bufferCompare(baselinePath: string, currentPath: string): ComparisonResult {
  const a = readFileSync(baselinePath);
  const b = readFileSync(currentPath);
  const identical = a.equals(b);

  return {
    similarity: identical ? 1.0 : 0.0,
    totalPixels: 0,
    differingPixels: identical ? 0 : 1,
    dimensionsMatch: a.length === b.length,
    baselineDimensions: { width: 0, height: 0 },
    currentDimensions: { width: 0, height: 0 },
  };
}
