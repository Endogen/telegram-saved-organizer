import fs from "node:fs/promises";
import path from "node:path";
import inspector from "node:inspector";
import { fileURLToPath } from "node:url";

const runtimeState = {
  session: null,
};

function callInspector(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!runtimeState.session) {
      resolve({});
      return;
    }

    runtimeState.session.post(method, params, (error, result = {}) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function stripQueryAndHash(value) {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const endIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), value.length);
  return value.slice(0, endIndex);
}

function normalizeScriptPath(root, url) {
  if (!url || url.startsWith("node:")) {
    return null;
  }

  let normalizedUrl = stripQueryAndHash(url);

  if (normalizedUrl.startsWith("/@fs/")) {
    normalizedUrl = normalizedUrl.slice(4);
  }

  let filePath = null;

  if (normalizedUrl.startsWith("file://")) {
    try {
      filePath = fileURLToPath(normalizedUrl);
    } catch {
      return null;
    }
  } else if (path.isAbsolute(normalizedUrl)) {
    filePath = normalizedUrl;
  }

  if (!filePath) {
    return null;
  }

  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  const normalizedRelativePath = relativePath.split(path.sep).join("/");

  if (!normalizedRelativePath.startsWith("src/")) {
    return null;
  }

  if (normalizedRelativePath.includes("/test/") || normalizedRelativePath.includes(".test.")) {
    return null;
  }

  if (normalizedRelativePath.startsWith("src/types/")) {
    return null;
  }

  if (!normalizedRelativePath.endsWith(".ts") && !normalizedRelativePath.endsWith(".tsx")) {
    return null;
  }

  return absolutePath;
}

function buildLineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetToLine(offsets, value) {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = offsets[mid];
    const next = mid + 1 < offsets.length ? offsets[mid + 1] : Number.POSITIVE_INFINITY;

    if (value < current) {
      high = mid - 1;
    } else if (value >= next) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

function lineCandidates(source) {
  return source.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.startsWith("//")) {
      return false;
    }

    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return false;
    }

    return true;
  });
}

function isTopLevelFunction(fnCoverage, sourceLength) {
  if (!fnCoverage || !Array.isArray(fnCoverage.ranges) || fnCoverage.ranges.length === 0) {
    return false;
  }

  const [firstRange] = fnCoverage.ranges;
  const coversWholeScript =
    firstRange.startOffset === 0 && firstRange.endOffset >= Math.max(1, sourceLength - 1);

  return fnCoverage.functionName === "" && coversWholeScript;
}

function pct(covered, total) {
  if (total <= 0) {
    return 100;
  }

  return Number(((covered / total) * 100).toFixed(2));
}

function safeCount(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

export async function startCoverage() {
  if (runtimeState.session) {
    return;
  }

  const session = new inspector.Session();
  session.connect();
  runtimeState.session = session;

  await callInspector("Profiler.enable");
  await callInspector("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: true,
  });
}

export async function takeCoverage() {
  if (!runtimeState.session) {
    return [];
  }

  const result = await callInspector("Profiler.takePreciseCoverage");
  return Array.isArray(result.result) ? result.result : [];
}

export async function stopCoverage() {
  if (!runtimeState.session) {
    return;
  }

  await callInspector("Profiler.stopPreciseCoverage");
  await callInspector("Profiler.disable");

  runtimeState.session.disconnect();
  runtimeState.session = null;
}

class OfflineV8CoverageProvider {
  constructor() {
    this.name = "offline-v8";
    this.ctx = null;
    this.root = process.cwd();
    this.coverageResults = [];
    this.coverageDirectory = path.resolve(this.root, "coverage");
    this.options = {};
  }

  initialize(ctx) {
    this.ctx = ctx;
    this.root = ctx.config.root;
    this.options = ctx.config.coverage ?? {};
    const reportsDirectory = this.options.reportsDirectory ?? "coverage";
    this.coverageDirectory = path.resolve(this.root, reportsDirectory);
  }

  resolveOptions() {
    return this.ctx.config.coverage;
  }

  async clean(clean = true) {
    if (!clean) {
      return;
    }

    await fs.rm(this.coverageDirectory, { force: true, recursive: true });
  }

  onAfterSuiteRun(meta) {
    const { coverage } = meta;

    if (!coverage) {
      return;
    }

    if (Array.isArray(coverage)) {
      this.coverageResults.push(coverage);
      return;
    }

    if (Array.isArray(coverage.result)) {
      this.coverageResults.push(coverage.result);
    }
  }

  async generateCoverage() {
    const files = new Map();
    const debugUrls = new Set();

    for (const suiteCoverage of this.coverageResults) {
      for (const script of suiteCoverage) {
        if (process.env.COVERAGE_DEBUG === "1" && typeof script?.url === "string" && debugUrls.size < 40) {
          debugUrls.add(script.url);
        }
        const filePath = normalizeScriptPath(this.root, script.url);
        if (!filePath) {
          continue;
        }

        let fileEntry = files.get(filePath);
        if (!fileEntry) {
          const source = await fs.readFile(filePath, "utf8");
          const offsets = buildLineOffsets(source);
          const candidates = lineCandidates(source);

          fileEntry = {
            path: filePath,
            source,
            offsets,
            candidates,
            lineBestSpan: Array.from({ length: candidates.length }, () => Number.POSITIVE_INFINITY),
            lineBestCount: Array.from({ length: candidates.length }, () => 0),
            functionsTotal: 0,
            functionsCovered: 0,
            rangesTotal: 0,
            rangesCovered: 0,
          };
          files.set(filePath, fileEntry);
        }

        const fnList = Array.isArray(script.functions) ? script.functions : [];

        for (const fnCoverage of fnList) {
          const ranges = Array.isArray(fnCoverage.ranges) ? fnCoverage.ranges : [];
          if (ranges.length === 0) {
            continue;
          }

          const topLevel = isTopLevelFunction(fnCoverage, fileEntry.source.length);
          if (!topLevel) {
            fileEntry.functionsTotal += 1;
            if (ranges.some((range) => safeCount(range.count) > 0)) {
              fileEntry.functionsCovered += 1;
            }
          }

          for (let index = 0; index < ranges.length; index += 1) {
            const range = ranges[index];
            const start = Math.max(0, Math.min(fileEntry.source.length, safeCount(range.startOffset)));
            const endExclusive = Math.max(start, Math.min(fileEntry.source.length, safeCount(range.endOffset)));

            if (endExclusive <= start) {
              continue;
            }

            const startLine = offsetToLine(fileEntry.offsets, start);
            const endLine = offsetToLine(fileEntry.offsets, Math.max(start, endExclusive - 1));
            const span = endExclusive - start;
            const count = safeCount(range.count);

            for (let line = startLine; line <= endLine; line += 1) {
              if (!fileEntry.candidates[line]) {
                continue;
              }

              if (
                span < fileEntry.lineBestSpan[line] ||
                (span === fileEntry.lineBestSpan[line] && count > fileEntry.lineBestCount[line])
              ) {
                fileEntry.lineBestSpan[line] = span;
                fileEntry.lineBestCount[line] = count;
              }
            }

            if (!(topLevel && index === 0)) {
              fileEntry.rangesTotal += 1;
              if (count > 0) {
                fileEntry.rangesCovered += 1;
              }
            }
          }
        }
      }
    }

    const fileSummaries = [];

    for (const entry of files.values()) {
      let linesTotal = 0;
      let linesCovered = 0;

      for (let line = 0; line < entry.candidates.length; line += 1) {
        if (!entry.candidates[line]) {
          continue;
        }

        if (entry.lineBestSpan[line] === Number.POSITIVE_INFINITY) {
          continue;
        }

        linesTotal += 1;
        if (entry.lineBestCount[line] > 0) {
          linesCovered += 1;
        }
      }

      fileSummaries.push({
        file: path.relative(this.root, entry.path).split(path.sep).join("/"),
        lines: {
          total: linesTotal,
          covered: linesCovered,
          pct: pct(linesCovered, linesTotal),
        },
        functions: {
          total: entry.functionsTotal,
          covered: entry.functionsCovered,
          pct: pct(entry.functionsCovered, entry.functionsTotal),
        },
        statements: {
          total: entry.rangesTotal,
          covered: entry.rangesCovered,
          pct: pct(entry.rangesCovered, entry.rangesTotal),
        },
        branches: {
          total: entry.rangesTotal,
          covered: entry.rangesCovered,
          pct: pct(entry.rangesCovered, entry.rangesTotal),
        },
      });
    }

    fileSummaries.sort((a, b) => a.file.localeCompare(b.file));

    const totals = fileSummaries.reduce(
      (acc, file) => {
        acc.lines.total += file.lines.total;
        acc.lines.covered += file.lines.covered;
        acc.functions.total += file.functions.total;
        acc.functions.covered += file.functions.covered;
        acc.statements.total += file.statements.total;
        acc.statements.covered += file.statements.covered;
        acc.branches.total += file.branches.total;
        acc.branches.covered += file.branches.covered;
        return acc;
      },
      {
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        statements: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 },
      },
    );

    const summary = {
      total: {
        lines: {
          ...totals.lines,
          pct: pct(totals.lines.covered, totals.lines.total),
        },
        functions: {
          ...totals.functions,
          pct: pct(totals.functions.covered, totals.functions.total),
        },
        statements: {
          ...totals.statements,
          pct: pct(totals.statements.covered, totals.statements.total),
        },
        branches: {
          ...totals.branches,
          pct: pct(totals.branches.covered, totals.branches.total),
        },
      },
      files: fileSummaries,
    };

    if (process.env.COVERAGE_DEBUG === "1" && fileSummaries.length === 0 && debugUrls.size > 0) {
      this.ctx.logger.log(`Coverage debug URLs: ${JSON.stringify(Array.from(debugUrls), null, 2)}`);
    }

    this.coverageResults = [];
    return summary;
  }

  async reportCoverage(coverageSummary) {
    await fs.mkdir(this.coverageDirectory, { recursive: true });

    const summaryFile = path.join(this.coverageDirectory, "coverage-summary.json");
    await fs.writeFile(summaryFile, `${JSON.stringify(coverageSummary, null, 2)}\n`, "utf8");

    const totals = coverageSummary.total;
    const rows = [
      ["Metric", "Covered", "Total", "Pct"],
      ["Lines", String(totals.lines.covered), String(totals.lines.total), `${totals.lines.pct}%`],
      ["Functions", String(totals.functions.covered), String(totals.functions.total), `${totals.functions.pct}%`],
      ["Statements", String(totals.statements.covered), String(totals.statements.total), `${totals.statements.pct}%`],
      ["Branches", String(totals.branches.covered), String(totals.branches.total), `${totals.branches.pct}%`],
    ];

    const colWidths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
    const formatRow = (row) =>
      row
        .map((value, col) => value.padEnd(colWidths[col], " "))
        .join("  ");

    const output = [
      "Coverage summary (custom offline provider)",
      ...rows.map(formatRow),
      `Coverage JSON: ${path.relative(this.root, summaryFile).split(path.sep).join("/")}`,
    ].join("\n");

    this.ctx.logger.log(output);

    const minimum = 80;
    const belowThreshold =
      totals.lines.pct < minimum ||
      totals.functions.pct < minimum ||
      totals.statements.pct < minimum ||
      totals.branches.pct < minimum;

    if (belowThreshold) {
      this.ctx.logger.error(
        `Coverage threshold not met: require >=${minimum}% for lines/functions/statements/branches.`,
      );
      process.exitCode = 1;
    }
  }
}

export default {
  getProvider() {
    return new OfflineV8CoverageProvider();
  },
};
