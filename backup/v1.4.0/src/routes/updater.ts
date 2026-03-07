import { Router } from 'express';
import { asyncHandler } from '../utils/errors';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import https from 'https';
import http from 'http';

const router = Router();

const ROOT_DIR = path.join(__dirname, '../../..');
const UPDATES_DIR = path.join(ROOT_DIR, 'data/updates');

/**
 * GET /api/updater/check
 * Check for updates by fetching remote version manifest.
 * Uses Setting 'updater.url' or defaults to empty (no auto-check).
 */
router.get('/check', asyncHandler(async (_req, res) => {
  const currentVersion = (global as any).APP_VERSION || '0.0.0';

  // Get update URL from settings
  const prisma = (await import('../utils/prisma')).default;
  const urlSetting = await prisma.setting.findUnique({ where: { key: 'updater.url' } });
  const updateUrl = urlSetting?.value;

  if (!updateUrl) {
    return res.json({
      success: true,
      data: {
        currentVersion,
        updateAvailable: false,
        message: 'Update URL not configured. Set updater.url in Settings.',
      },
    });
  }

  try {
    const manifest = await fetchJson(updateUrl);

    const updateAvailable = compareVersions(manifest.latest, currentVersion) > 0;

    res.json({
      success: true,
      data: {
        currentVersion,
        latestVersion: manifest.latest,
        updateAvailable,
        changelog: manifest.changelog || '',
        downloadUrl: manifest.downloadUrl || '',
        size: manifest.size || 0,
        releaseDate: manifest.releaseDate || '',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[Updater] Check failed: ${msg}`);
    res.json({
      success: true,
      data: {
        currentVersion,
        updateAvailable: false,
        error: `Failed to check: ${msg}`,
      },
    });
  }
}));

/**
 * POST /api/updater/download
 * Download update ZIP from the provided URL and save to data/updates/.
 */
router.post('/download', asyncHandler(async (req, res) => {
  const { downloadUrl } = req.body;
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    return res.status(400).json({ success: false, error: { message: 'downloadUrl is required' } });
  }

  const broadcast = (global as any).wsBroadcast;

  // Ensure updates directory
  if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });

  const fileName = 'update-latest.zip';
  const filePath = path.join(UPDATES_DIR, fileName);

  // Remove old download if exists
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  try {
    if (broadcast) broadcast({ type: 'UPDATE_STATUS', data: { status: 'downloading', message: 'Downloading update...' } });

    await downloadFile(downloadUrl, filePath);

    const stats = fs.statSync(filePath);
    if (broadcast) broadcast({ type: 'UPDATE_STATUS', data: { status: 'downloaded', message: 'Download complete', size: stats.size } });

    res.json({ success: true, data: { filePath: fileName, size: stats.size } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (broadcast) broadcast({ type: 'UPDATE_STATUS', data: { status: 'error', message: `Download failed: ${msg}` } });
    res.status(500).json({ success: false, error: { message: `Download failed: ${msg}` } });
  }
}));

/**
 * POST /api/updater/apply
 * Apply the downloaded update: spawn detached update script, then shutdown server.
 */
router.post('/apply', asyncHandler(async (_req, res) => {
  const zipPath = path.join(UPDATES_DIR, 'update-latest.zip');

  if (!fs.existsSync(zipPath)) {
    return res.status(400).json({ success: false, error: { message: 'No update downloaded. Run download first.' } });
  }

  const broadcast = (global as any).wsBroadcast;

  // Generate the update PowerShell script
  const scriptPath = path.join(UPDATES_DIR, 'run-update.ps1');
  const updateScript = generateUpdateScript(ROOT_DIR, zipPath);
  fs.writeFileSync(scriptPath, updateScript, 'utf-8');

  logger.info('[Updater] Spawning update script and shutting down...');
  if (broadcast) broadcast({ type: 'UPDATE_STATUS', data: { status: 'applying', message: 'Applying update... Server will restart shortly.' } });

  // Send response before shutdown
  res.json({ success: true, data: { message: 'Update is being applied. Server will restart in ~30-60 seconds.' } });

  // Small delay to ensure response is sent
  setTimeout(() => {
    // Spawn detached PowerShell process
    const child = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
    ], {
      detached: true,
      stdio: 'ignore',
      cwd: ROOT_DIR,
    });
    child.unref();

    logger.info('[Updater] Update script spawned, shutting down server...');

    // Shutdown server
    const shutdownFn = (global as any).shutdownServer;
    if (shutdownFn) {
      shutdownFn();
    } else {
      process.exit(0);
    }
  }, 1000);
}));

/**
 * POST /api/updater/upload
 * Upload a local update ZIP file (for offline/manual update).
 */
router.post('/upload', asyncHandler(async (req, res) => {
  // Check if express-fileupload is available
  if (!req.files || !req.files.updateFile) {
    return res.status(400).json({ success: false, error: { message: 'No file uploaded. Send as updateFile.' } });
  }

  const file = req.files.updateFile as any;
  if (!file.name.endsWith('.zip')) {
    return res.status(400).json({ success: false, error: { message: 'Only .zip files are accepted.' } });
  }

  if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });

  const filePath = path.join(UPDATES_DIR, 'update-latest.zip');
  await file.mv(filePath);

  res.json({ success: true, data: { fileName: file.name, size: file.size } });
}));

// === Helper Functions ===

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'BOT-NTO-Updater' } }, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchJson(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'BOT-NTO-Updater' } }, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    });
    req.on('error', (err) => { if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(err); });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function generateUpdateScript(rootDir: string, zipPath: string): string {
  // Use string concatenation to avoid template literal conflicts with PowerShell $ syntax
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const r = esc(rootDir);
  const z = esc(zipPath);
  const lines = [
    '# BOT NTO Auto-Updater Script',
    '# Generated at: ' + new Date().toISOString(),
    '',
    '$ErrorActionPreference = "Continue"',
    "$rootDir = '" + r + "'",
    "$zipPath = '" + z + "'",
    "$logFile = Join-Path $rootDir 'data\\updates\\update.log'",
    '$port = 6969',
    '',
    'function Log($msg) {',
    '    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"',
    '    $line = "[$ts] $msg"',
    '    Write-Host $line',
    '    Add-Content -Path $logFile -Value $line',
    '}',
    '',
    'Log "=== BOT NTO Update Started ==="',
    'Log "Root: $rootDir"',
    '',
    '# Step 1: Wait for server to stop (max 30s)',
    'Log "Waiting for server to stop (port $port)..."',
    '$waited = 0',
    'while ($waited -lt 30) {',
    "    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object State -eq 'Listen'",
    '    if (-not $conn) { break }',
    '    Start-Sleep -Seconds 2',
    '    $waited += 2',
    '}',
    '',
    '# Force kill if still running',
    "$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object State -eq 'Listen'",
    'if ($conn) {',
    '    Log "Force killing process on port $port..."',
    '    foreach ($c in $conn) {',
    '        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue',
    '    }',
    '    Start-Sleep -Seconds 2',
    '}',
    'Log "Server stopped."',
    '',
    '# Step 2: Backup database',
    "$dbFile = Join-Path $rootDir 'data\\bot-nto.db'",
    'if (Test-Path $dbFile) {',
    '    $backupName = "bot-nto.db.backup-$(Get-Date -Format \'yyyyMMdd-HHmmss\')"',
    '    $backupPath = Join-Path $rootDir "data\\$backupName"',
    '    Copy-Item $dbFile $backupPath',
    '    Log "Database backed up: $backupName"',
    '}',
    '',
    '# Step 3: Extract update ZIP',
    'Log "Extracting update..."',
    "$tempExtract = Join-Path $rootDir 'data\\updates\\extracted'",
    'if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }',
    '',
    'try {',
    '    Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force',
    '    Log "ZIP extracted to temp folder."',
    '} catch {',
    '    Log "ERROR: Failed to extract ZIP: $_"',
    '    Log "Update aborted. Server not restarted."',
    '    exit 1',
    '}',
    '',
    '# Step 4: Copy files (preserve data/, profiles/, .env)',
    'Log "Copying updated files..."',
    '',
    "# Copy SERVER/src",
    "$srcDir = Join-Path $tempExtract 'SERVER\\src'",
    'if (Test-Path $srcDir) {',
    "    $destSrc = Join-Path $rootDir 'SERVER\\src'",
    '    if (Test-Path $destSrc) { Remove-Item $destSrc -Recurse -Force }',
    '    Copy-Item $srcDir $destSrc -Recurse -Force',
    '    Log "  SERVER/src updated."',
    '}',
    '',
    "# Copy SERVER/prisma",
    "$prismaDir = Join-Path $tempExtract 'SERVER\\prisma'",
    'if (Test-Path $prismaDir) {',
    "    $destPrisma = Join-Path $rootDir 'SERVER\\prisma'",
    '    if (Test-Path $destPrisma) { Remove-Item $destPrisma -Recurse -Force }',
    '    Copy-Item $prismaDir $destPrisma -Recurse -Force',
    '    Log "  SERVER/prisma updated."',
    '}',
    '',
    "# Copy SERVER/package.json",
    "$pkgJson = Join-Path $tempExtract 'SERVER\\package.json'",
    'if (Test-Path $pkgJson) {',
    "    Copy-Item $pkgJson (Join-Path $rootDir 'SERVER\\package.json') -Force",
    '    Log "  SERVER/package.json updated."',
    '}',
    '',
    "# Copy SERVER/tsconfig.json",
    "$tsconfig = Join-Path $tempExtract 'SERVER\\tsconfig.json'",
    'if (Test-Path $tsconfig) {',
    "    Copy-Item $tsconfig (Join-Path $rootDir 'SERVER\\tsconfig.json') -Force",
    '    Log "  SERVER/tsconfig.json updated."',
    '}',
    '',
    "# Copy panel/",
    "$panelDir = Join-Path $tempExtract 'panel'",
    'if (Test-Path $panelDir) {',
    "    $destPanel = Join-Path $rootDir 'panel'",
    '    if (Test-Path $destPanel) { Remove-Item $destPanel -Recurse -Force }',
    '    Copy-Item $panelDir $destPanel -Recurse -Force',
    '    Log "  panel/ updated."',
    '}',
    '',
    "# Copy root package.json",
    "$rootPkg = Join-Path $tempExtract 'package.json'",
    'if (Test-Path $rootPkg) {',
    "    Copy-Item $rootPkg (Join-Path $rootDir 'package.json') -Force",
    '    Log "  root package.json updated."',
    '}',
    '',
    "# Copy launcher scripts if present",
    "foreach ($f in @('start.bat', 'start.vbs', 'stop.bat')) {",
    '    $src = Join-Path $tempExtract "installer\\$f"',
    '    if (Test-Path $src) {',
    '        Copy-Item $src (Join-Path $rootDir $f) -Force',
    '        Log "  $f updated."',
    '    }',
    '}',
    '',
    '# Step 5: npm install',
    'Log "Running npm install..."',
    '$env:PATH = "$env:ProgramFiles\\nodejs;$env:PATH"',
    "$serverDir = Join-Path $rootDir 'SERVER'",
    '$npmResult = Start-Process -FilePath cmd.exe -ArgumentList "/c cd /d `"$serverDir`" && npm install" -Wait -PassThru -NoNewWindow',
    'Log "npm install exit code: $($npmResult.ExitCode)"',
    '',
    '# Step 6: Prisma generate + push',
    'Log "Running prisma generate..."',
    '$prismaGen = Start-Process -FilePath cmd.exe -ArgumentList "/c cd /d `"$serverDir`" && npx prisma generate" -Wait -PassThru -NoNewWindow',
    'Log "prisma generate exit code: $($prismaGen.ExitCode)"',
    '',
    'Log "Running prisma db push..."',
    '$prismaDb = Start-Process -FilePath cmd.exe -ArgumentList "/c cd /d `"$serverDir`" && npx prisma db push --skip-generate" -Wait -PassThru -NoNewWindow',
    'Log "prisma db push exit code: $($prismaDb.ExitCode)"',
    '',
    '# Step 7: Cleanup',
    'Log "Cleaning up..."',
    'Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue',
    'Remove-Item $zipPath -Force -ErrorAction SilentlyContinue',
    '',
    '# Step 8: Restart server',
    'Log "Restarting server..."',
    "$startVbs = Join-Path $rootDir 'start.vbs'",
    "$startBat = Join-Path $rootDir 'start.bat'",
    'if (Test-Path $startVbs) {',
    '    Start-Process wscript.exe -ArgumentList "`"$startVbs`"" -WorkingDirectory $rootDir',
    '    Log "Server restarted via start.vbs"',
    '} elseif (Test-Path $startBat) {',
    '    Start-Process cmd.exe -ArgumentList "/c `"$startBat`"" -WorkingDirectory $rootDir',
    '    Log "Server restarted via start.bat"',
    '} else {',
    '    Start-Process cmd.exe -ArgumentList "/c cd /d `"$serverDir`" && npx tsx src/index.ts" -WorkingDirectory $serverDir',
    '    Log "Server restarted via npx tsx"',
    '}',
    '',
    'Log "=== Update Complete ==="',
  ];
  return lines.join('\r\n');
}

export default router;
