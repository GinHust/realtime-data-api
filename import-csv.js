const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const sourcePath = process.argv[2];
const DB_PATH = path.join(__dirname, "data.json");

if (!sourcePath) {
  console.error("Usage: node import-csv.js <csv-path>");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }

  return rows;
}

function coerceValue(value) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const number = Number(trimmed);
  if (!Number.isNaN(number) && trimmed === String(number)) {
    return number;
  }

  return trimmed;
}

async function main() {
  const raw = await fs.readFile(sourcePath, "utf8");
  const rows = parseCsv(raw);

  if (rows.length < 2) {
    throw new Error("CSV does not contain data rows.");
  }

  const headers = rows[0].map((header) => header.trim());
  const now = new Date().toISOString();
  const items = rows.slice(1).map((values, rowIndex) => {
    const data = {};

    headers.forEach((header, columnIndex) => {
      data[header] = coerceValue(values[columnIndex] ?? "");
    });

    return {
      id: crypto.randomUUID(),
      data,
      source: {
        file: sourcePath,
        row: rowIndex + 2
      },
      createdAt: now,
      updatedAt: now
    };
  });

  const db = {
    source: {
      file: sourcePath,
      importedAt: now,
      rows: items.length,
      columns: headers
    },
    items,
    updates: [
      {
        id: crypto.randomUUID(),
        type: "dataset.imported",
        data: {
          file: sourcePath,
          rows: items.length,
          columns: headers
        },
        createdAt: now
      }
    ],
    updatedAt: now
  };

  const tempPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, DB_PATH);

  console.log(JSON.stringify({
    imported: items.length,
    columns: headers,
    output: DB_PATH
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
