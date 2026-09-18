/**
 * Omni Beauté product sync
 *
 * Drive folder  ->  GitHub
 *   photo.jpg   ->  assets/products/photo.jpg
 *   photo.txt   ->  assets/products/photo.txt
 *               ->  data/products.json
 *
 * Run in the Apps Script editor:
 *   1. previewDriveFolder  — check pairing, does not write to GitHub
 *   2. syncProductsToGitHub — upload / update / delete
 *
 * Script properties (Project Settings):
 *   DRIVE_FOLDER_ID   required
 *   GITHUB_TOKEN      required for sync
 *   GITHUB_REPO       default gordon-make/omni_beaute
 *   GITHUB_BRANCH     default main
 *   DRY_RUN           true = log only, no GitHub writes
 */

var IMAGE_EXTS = {
  jpg: true,
  jpeg: true,
  png: true
};

var ASSET_DIR = "assets/products";
var CATALOG_PATH = "data/products.json";
var DEFAULT_REPO = "gordon-make/omni_beaute";
var DEFAULT_BRANCH = "main";

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Omni Beauté")
      .addItem("Preview Drive folder", "previewDriveFolder")
      .addItem("Sync products to GitHub", "syncProductsToGitHub")
      .addToUi();
  } catch (error) {
    Logger.log("onOpen skipped (use a Google Sheet if you want the menu).");
  }
}

function previewDriveFolder() {
  var pairs = collectDrivePairs();
  pairs.forEach(function (pair) {
    Logger.log(
      (pair.image ? "OK " : "NO IMAGE ") +
        pair.stem +
        " | image=" +
        (pair.image ? pair.image.getName() : "-") +
        " | txt=" +
        (pair.txt ? pair.txt.getName() : "MISSING")
    );
  });
  Logger.log("Found " + pairs.length + " product stem(s).");
}

function syncProductsToGitHub() {
  var cfg = getConfig(true);
  var pairs = collectDrivePairs();
  var githubFiles = githubListDir(cfg, ASSET_DIR);
  var keep = { ".gitkeep": true };
  var products = [];
  var index = getSyncIndex();

  pairs.forEach(function (pair) {
    if (!pair.image) {
      Logger.log("Skip " + pair.stem + " (no photo)");
      return;
    }

    var imageName = pair.image.getName();
    var parsed = pair.txt
      ? parseProductText(pair.txt.getBlob().getDataAsString("UTF-8"), pair.stem)
      : { name: pair.stem, price: "", description: "" };

    uploadDriveFileIfChanged(cfg, ASSET_DIR + "/" + imageName, pair.image, index);
    keep[imageName] = true;

    if (pair.txt) {
      uploadDriveFileIfChanged(cfg, ASSET_DIR + "/" + pair.txt.getName(), pair.txt, index);
      keep[pair.txt.getName()] = true;
    }

    products.push({
      id: pair.stem,
      name: parsed.name,
      price: parsed.price,
      description: parsed.description,
      image: ASSET_DIR + "/" + imageName,
      active: true
    });
  });

  products.sort(function (a, b) {
    return a.id.localeCompare(b.id, "zh-Hant");
  });

  writeCatalog(cfg, products);

  Object.keys(githubFiles).forEach(function (name) {
    if (!keep[name]) {
      Logger.log("Delete " + name);
      githubDelete(cfg, ASSET_DIR + "/" + name, githubFiles[name].sha, "sync(products): remove " + name);
    }
  });

  if (!cfg.dryRun) {
    saveSyncIndex(index);
  }
  Logger.log("Sync complete. Products: " + products.length);
}

function collectDrivePairs() {
  var cfg = getConfig(false);
  var folder = DriveApp.getFolderById(cfg.folderId);
  var files = folder.getFiles();
  var byStem = {};
  var ignored = [];

  while (files.hasNext()) {
    var file = files.next();
    var parsed = parseFileName(file.getName());
    if (!parsed) {
      ignored.push(file.getName());
      continue;
    }
    if (!byStem[parsed.stem]) {
      byStem[parsed.stem] = { stem: parsed.stem, image: null, txt: null };
    }
    if (parsed.kind === "image") {
      if (byStem[parsed.stem].image) {
        Logger.log("Warning: extra image for " + parsed.stem + ": " + file.getName());
      }
      byStem[parsed.stem].image = file;
    } else {
      byStem[parsed.stem].txt = file;
    }
  }

  if (ignored.length) {
    Logger.log("Ignored: " + ignored.join(", "));
  }

  return Object.keys(byStem)
    .sort()
    .map(function (stem) {
      return byStem[stem];
    });
}

function parseFileName(name) {
  var lower = name.toLowerCase();
  if (lower === ".gitkeep" || lower === "thumbs.db" || lower === "desktop.ini") {
    return null;
  }
  var dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  var stem = name.substring(0, dot).trim();
  var ext = lower.substring(dot + 1);
  if (IMAGE_EXTS[ext]) {
    return { stem: stem, kind: "image" };
  }
  if (ext === "txt") {
    return { stem: stem, kind: "txt" };
  }
  return null;
}

function parseProductText(raw, fallbackName) {
  var text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return { name: fallbackName, price: "", description: "" };
  }

  var lines = text.split("\n");
  var i = 0;
  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  var name = (lines[i] || fallbackName).trim();
  i++;
  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  var price = "";
  if (i < lines.length && isPriceLine(lines[i])) {
    price = lines[i].trim();
    i++;
    while (i < lines.length && !lines[i].trim()) {
      i++;
    }
  }

  return {
    name: name || fallbackName,
    price: price,
    description: lines.slice(i).join("\n").trim()
  };
}

function isPriceLine(line) {
  var value = String(line || "").trim();
  if (!value || value.length > 40) {
    return false;
  }
  if (/^(HK\$|USD|\$|港幣|售價|價格|特價|查詢報價)/i.test(value)) {
    return true;
  }
  return /^[\$£€¥]?[\d,]+(\.\d{1,2})?\s*(HKD|USD|港元)?$/i.test(value);
}

function uploadDriveFileIfChanged(cfg, path, file, index) {
  var stamp = String(file.getLastUpdated().getTime()) + ":" + file.getSize();
  if (index[path] === stamp) {
    Logger.log("Unchanged " + path);
    return;
  }
  Logger.log("Upload " + path);
  githubPut(cfg, path, file.getBlob(), "sync(products): update " + file.getName());
  if (!cfg.dryRun) {
    index[path] = stamp;
  }
}

function writeCatalog(cfg, products) {
  var payload = {
    updatedAt: new Date().toISOString(),
    source: "google-drive",
    products: products
  };
  var blob = Utilities.newBlob(JSON.stringify(payload, null, 2), "application/json", "products.json");
  githubPut(cfg, CATALOG_PATH, blob, "sync(products): refresh catalog");
}

function githubListDir(cfg, dir) {
  var result = {};
  if (!cfg.token) {
    return result;
  }
  var response = githubRequest(cfg, "GET", dir);
  if (response.status === 404) {
    return result;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("GitHub list failed " + response.status + ": " + response.body);
  }
  var items = JSON.parse(response.body);
  if (!Array.isArray(items)) {
    return result;
  }
  items.forEach(function (item) {
    if (item.type === "file") {
      result[item.name] = item;
    }
  });
  return result;
}

function githubPut(cfg, path, blob, message) {
  if (cfg.dryRun) {
    Logger.log("[dry-run] PUT " + path);
    return;
  }
  var existing = githubRequest(cfg, "GET", path);
  var payload = {
    message: message,
    content: Utilities.base64Encode(blob.getBytes()),
    branch: cfg.branch
  };
  if (existing.status === 200) {
    payload.sha = JSON.parse(existing.body).sha;
  }
  var response = githubRequest(cfg, "PUT", path, payload);
  if (response.status === 409 || (response.body && response.body.indexOf("identical") !== -1)) {
    Logger.log("GitHub identical " + path);
    return;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("GitHub put failed " + path + " " + response.status + ": " + response.body);
  }
}

function githubDelete(cfg, path, sha, message) {
  if (cfg.dryRun) {
    Logger.log("[dry-run] DELETE " + path);
    return;
  }
  if (!sha) {
    var existing = githubRequest(cfg, "GET", path);
    if (existing.status !== 200) {
      return;
    }
    sha = JSON.parse(existing.body).sha;
  }
  var response = githubRequest(cfg, "DELETE", path, {
    message: message,
    sha: sha,
    branch: cfg.branch
  });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error("GitHub delete failed " + path + " " + response.status + ": " + response.body);
  }
}

function githubRequest(cfg, method, path, payload) {
  var encodedPath = String(path)
    .split("/")
    .map(function (part) {
      return encodeURIComponent(part);
    })
    .join("/");
  var url = "https://api.github.com/repos/" + cfg.repo + "/contents/" + encodedPath;
  if (method === "GET") {
    url += "?ref=" + encodeURIComponent(cfg.branch);
  }
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "User-Agent": "OmniBeaute-ProductSync",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  if (cfg.dryRun && method !== "GET") {
    return { status: 200, body: "{}" };
  }
  if (!cfg.token && method !== "GET") {
    throw new Error("GITHUB_TOKEN is missing");
  }
  var response = UrlFetchApp.fetch(url, options);
  return {
    status: response.getResponseCode(),
    body: response.getContentText()
  };
}

function normalizeDriveFolderId(value) {
  var raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  var fromUrl = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) {
    raw = fromUrl[1];
  }
  raw = raw.replace(/[?&].*$/, "");
  if (/^https?:\/\//i.test(raw) || raw.indexOf("/") !== -1 || raw.indexOf(" ") !== -1) {
    throw new Error(
      "DRIVE_FOLDER_ID 唔係資料夾名稱或完整路徑。請打開 Drive 資料夾，複製網址 folders/ 後面嗰串 ID，例如 1AbCDefGHijKLmNOPqrsTUVwxYZ"
    );
  }
  return raw;
}

function getConfig(needGithub) {
  var props = PropertiesService.getScriptProperties();
  var folderId = normalizeDriveFolderId(props.getProperty("DRIVE_FOLDER_ID"));
  if (!folderId) {
    throw new Error("Set script property DRIVE_FOLDER_ID");
  }
  var token = String(props.getProperty("GITHUB_TOKEN") || "").trim();
  var dryRun = String(props.getProperty("DRY_RUN") || "").toLowerCase() === "true";
  if (needGithub && !token && !dryRun) {
    throw new Error("Set script property GITHUB_TOKEN");
  }
  return {
    folderId: folderId,
    token: token,
    repo: String(props.getProperty("GITHUB_REPO") || DEFAULT_REPO).trim(),
    branch: String(props.getProperty("GITHUB_BRANCH") || DEFAULT_BRANCH).trim(),
    dryRun: dryRun
  };
}

function getSyncIndex() {
  var raw = PropertiesService.getScriptProperties().getProperty("SYNC_INDEX");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function saveSyncIndex(index) {
  PropertiesService.getScriptProperties().setProperty("SYNC_INDEX", JSON.stringify(index));
}
