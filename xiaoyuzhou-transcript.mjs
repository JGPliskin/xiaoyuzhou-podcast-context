#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_KEYS = {
  key1: 'b597c31189c6211e4c8c03187baed63a',
  key2: '6A3A698E',
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const APP_USER_AGENT = 'Xiaoyuzhou/2.99.1(android 28)';
const API_BASE_URL = 'https://api.xiaoyuzhoufm.com';
const PODCASTER_API_BASE_URL = 'https://podcaster-api.xiaoyuzhoufm.com';
const TOKEN_TTL_MS = 20 * 60 * 1000;
const DEFAULT_CREDENTIALS_FILE = path.join(os.homedir(), '.opencli', 'xiaoyuzhou.json');
const ALL_FORMATS = ['json', 'raw.json', 'txt', 'raw.txt', 'srt'];

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (process.argv[2] === 'auth') {
    await mainAuth(process.argv.slice(3));
    return;
  }

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const formats = parseFormats(args.formats);
  const positional = args._[0];
  const podcastInput = args.podcast || (extractPodcastId(positional) ? positional : null);

  if (podcastInput) {
    await downloadPodcastBatch(podcastInput, args, formats);
    return;
  }

  const episodeInput = args.episode || positional;
  if (!episodeInput && !args.transcriptUrl && !args.har && !args.highlightId) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(args.outDir || 'downloads');
  await fs.mkdir(outDir, { recursive: true });

  const pageInfo = episodeInput ? await loadEpisodePage(episodeInput) : null;
  const transcriptSource = await loadTranscript(args, pageInfo);
  const episode = pageInfo?.episode || {};
  const eid = pageInfo?.episodeId || extractEpisodeId(episodeInput) || 'unknown-episode';

  const saved = await saveEpisodeTranscript({
    outDir,
    episode,
    eid,
    episodeUrl: episodeInput ? normalizeEpisodeUrl(episodeInput) : null,
    rawSegments: transcriptSource.segments,
    transcriptInfo: transcriptSource.info,
    formats,
  });

  console.log(`Saved ${saved.segmentCount} transcript segments:`);
  for (const file of saved.files) {
    console.log(`- ${file}`);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--episode' || arg === '-e') {
      args.episode = takeValue(argv, ++i, arg);
    } else if (arg === '--podcast' || arg === '-p') {
      args.podcast = takeValue(argv, ++i, arg);
    } else if (arg === '--formats' || arg === '-f') {
      args.formats = takeValue(argv, ++i, arg);
    } else if (arg === '--delay') {
      args.delay = Number(takeValue(argv, ++i, arg));
    } else if (arg === '--limit') {
      args.limit = Number(takeValue(argv, ++i, arg));
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--access-token') {
      args.accessToken = takeValue(argv, ++i, arg);
    } else if (arg === '--refresh-token') {
      args.refreshToken = takeValue(argv, ++i, arg);
    } else if (arg === '--har') {
      args.har = takeValue(argv, ++i, arg);
    } else if (arg === '--transcript-url') {
      args.transcriptUrl = takeValue(argv, ++i, arg);
    } else if (arg === '--highlight-id') {
      args.highlightId = takeValue(argv, ++i, arg);
    } else if (arg === '--edition') {
      args.edition = Number(takeValue(argv, ++i, arg));
    } else if (arg === '--key1') {
      args.key1 = takeValue(argv, ++i, arg);
    } else if (arg === '--key2') {
      args.key2 = takeValue(argv, ++i, arg);
    } else if (arg === '--credentials') {
      args.credentials = takeValue(argv, ++i, arg);
    } else if (arg === '--area-code') {
      args.areaCode = takeValue(argv, ++i, arg);
    } else if (arg === '--out-dir' || arg === '-o') {
      args.outDir = takeValue(argv, ++i, arg);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node xiaoyuzhou-transcript.mjs <episode-url> [-o downloads] [-f txt,raw.txt]
  node xiaoyuzhou-transcript.mjs <podcast-url> [-o downloads] [-f raw.txt]
  node xiaoyuzhou-transcript.mjs <episode-url> --har <capture.har> [-o downloads]
  node xiaoyuzhou-transcript.mjs <episode-url> --transcript-url <cdn-url>
  node xiaoyuzhou-transcript.mjs <episode-url> --highlight-id <id> [--edition 1]
  node xiaoyuzhou-transcript.mjs auth set-token <access-token> [refresh-token]
  node xiaoyuzhou-transcript.mjs auth send-code <phone>
  node xiaoyuzhou-transcript.mjs auth login <phone> <sms-code>
  node xiaoyuzhou-transcript.mjs auth status

Notes:
  The default path downloads Xiaoyuzhou's official transcript only. It does not
  download audio or run local ASR. Configure credentials once via auth set-token
  (using x-jike-access-token / x-jike-refresh-token cookies from podcaster.xiaoyuzhoufm.com)
  or auth login, then pass episode URLs or a podcast URL for batch download.
  HAR / transcript URL / highlight id modes are fallback paths.

Options:
  -e, --episode <url-or-id>       Xiaoyuzhou episode URL or episode id
  -p, --podcast <url-or-id>       Xiaoyuzhou podcast URL or pid (batch download)
  -f, --formats <list>            Comma-separated formats: ${ALL_FORMATS.join(',')}
      --delay <ms>                Delay between episodes in batch mode, default: 300
      --limit <number>            Max episodes to process in batch mode
      --force                     Overwrite existing files in batch mode
      --credentials <path>        Credential JSON, default: ${DEFAULT_CREDENTIALS_FILE}
      --har <path>                HAR file containing transcript-highlight request
      --transcript-url <url>      Direct transcript-highlight CDN URL
      --highlight-id <id>         CDN highlight id, encoded into get-highlight URL
      --edition <number>          Highlight edition, default: 1
      --key1 <value>              CDN KEY1, default from observed app traffic
      --key2 <value>              CDN KEY2, default from observed app traffic
  -o, --out-dir <path>            Output directory, default: downloads
`);
}

async function mainAuth(argv) {
  const command = argv[0];
  const args = parseArgs(argv.slice(1));
  const credentialsFile = path.resolve(args.credentials || DEFAULT_CREDENTIALS_FILE);

  if (!command || command === '--help' || command === '-h') {
    printAuthHelp();
    return;
  }

  if (command === 'set-token') {
    const accessToken = args.accessToken || args._[0];
    const refreshToken = args.refreshToken || args._[1];
    if (!accessToken && !refreshToken) {
      throw new Error('auth set-token requires at least an access token or refresh token.');
    }
    const existing = await loadCredentials(credentialsFile, { allowMissing: true });
    const credentials = normalizeCredentials({
      access_token: accessToken ?? existing?.accessToken,
      refresh_token: refreshToken ?? existing?.refreshToken,
      device_id: existing?.deviceId || randomUUID().toUpperCase(),
      uid: existing?.uid,
      nickname: existing?.nickname,
    });
    await saveCredentials(credentials, credentialsFile);
    console.log(JSON.stringify({
      ok: true,
      credentialsFile,
      accessToken: credentials.accessToken ? `set (${credentials.accessToken.length} chars)` : 'missing',
      refreshToken: credentials.refreshToken ? `set (${credentials.refreshToken.length} chars)` : 'missing',
    }, null, 2));
    return;
  }

  if (command === 'send-code') {
    const phone = args._[0];
    if (!phone) {
      throw new Error('auth send-code requires a phone number.');
    }
    const result = await sendSmsCode(phone, args.areaCode || '+86');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'login') {
    const [phone, code] = args._;
    if (!phone || !code) {
      throw new Error('auth login requires a phone number and SMS code.');
    }
    const credentials = await loginWithSms(phone, code, args.areaCode || '+86');
    await saveCredentials(credentials, credentialsFile);
    console.log(JSON.stringify({
      ok: true,
      uid: credentials.uid || null,
      nickname: credentials.nickname || null,
      credentialsFile,
    }, null, 2));
    return;
  }

  if (command === 'status') {
    const credentials = await loadCredentials(credentialsFile, { allowMissing: true });
    console.log(JSON.stringify({
      credentialsFile,
      exists: Boolean(credentials),
      accessToken: credentials?.accessToken ? `set (${credentials.accessToken.length} chars)` : 'missing',
      refreshToken: credentials?.refreshToken ? `set (${credentials.refreshToken.length} chars)` : 'missing',
      deviceId: credentials?.deviceId ? `set (${credentials.deviceId.length} chars)` : 'missing',
      expiresAt: credentials?.expiresAt || null,
    }, null, 2));
    return;
  }

  throw new Error(`Unknown auth command: ${command}`);
}

function printAuthHelp() {
  console.log(`Usage:
  node xiaoyuzhou-transcript.mjs auth set-token <access-token> [refresh-token]
  node xiaoyuzhou-transcript.mjs auth send-code <phone> [--area-code +86]
  node xiaoyuzhou-transcript.mjs auth login <phone> <sms-code> [--area-code +86]
  node xiaoyuzhou-transcript.mjs auth status

Credentials are saved to:
  ${DEFAULT_CREDENTIALS_FILE}
`);
}

async function sendSmsCode(phone, areaCode) {
  const response = await fetch(`${PODCASTER_API_BASE_URL}/v1/auth/send-code`, {
    method: 'POST',
    headers: webAuthHeaders(),
    body: JSON.stringify({ mobilePhoneNumber: phone, areaCode }),
  });
  const text = await response.text();
  if (response.status === 404) {
    throw new Error(
      'send-code failed with HTTP 404 (Xiaoyuzhou deprecated /v1/auth/send-code on podcaster-api, ' +
      'and api.xiaoyuzhoufm.com/v1/auth/sendCode requires captchaVerifyParam). ' +
      'Log in at https://podcaster.xiaoyuzhoufm.com in a browser, copy x-jike-access-token ' +
      'and x-jike-refresh-token from DevTools Cookies, and run: ' +
      'node xiaoyuzhou-transcript.mjs auth set-token <access-token> <refresh-token>'
    );
  }
  if (!response.ok) {
    throw new Error(`send-code failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return { ok: true, phone, areaCode };
}

async function loginWithSms(phone, code, areaCode) {
  const response = await fetch(`${PODCASTER_API_BASE_URL}/v1/auth/login-with-sms`, {
    method: 'POST',
    headers: webAuthHeaders(),
    body: JSON.stringify({
      areaCode,
      verifyCode: code,
      mobilePhoneNumber: phone,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`login failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const body = safeJson(text) || {};
  const user = body?.data?.user || {};
  const credentials = normalizeCredentials({
    access_token: response.headers.get('x-jike-access-token'),
    refresh_token: response.headers.get('x-jike-refresh-token'),
    device_id: randomUUID().toUpperCase(),
    expires_at: Date.now() + TOKEN_TTL_MS,
    uid: user.uid,
    nickname: user.nickname,
  });

  if (!credentials.accessToken || !credentials.refreshToken) {
    throw new Error('login response did not include x-jike-access-token and x-jike-refresh-token.');
  }
  return credentials;
}

function webAuthHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    origin: 'https://podcaster.xiaoyuzhoufm.com',
    referer: 'https://podcaster.xiaoyuzhoufm.com/',
    'user-agent': DEFAULT_USER_AGENT,
  };
}

async function loadEpisodePage(input) {
  const url = normalizeEpisodeUrl(input);
  const html = await fetchText(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': DEFAULT_USER_AGENT,
    },
  });

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(`Could not find __NEXT_DATA__ in episode page: ${url}`);
  }

  const nextData = JSON.parse(unescapeHtmlJson(match[1]));
  const pageProps = nextData.props?.pageProps || {};
  return {
    episodeId: pageProps.id || pageProps.episode?.eid || extractEpisodeId(input),
    episode: pageProps.episode || null,
  };
}

async function loadTranscript(args, pageInfo) {
  if (args.transcriptUrl) {
    return {
      segments: await fetchTranscriptUrl(args.transcriptUrl),
      info: { type: 'transcript-url', url: args.transcriptUrl },
    };
  }

  if (args.highlightId) {
    const url = buildHighlightUrl({
      id: args.highlightId,
      edition: Number.isFinite(args.edition) ? args.edition : 1,
      key1: args.key1 || DEFAULT_KEYS.key1,
      key2: args.key2 || DEFAULT_KEYS.key2,
    });
    return {
      segments: await fetchTranscriptUrl(url),
      info: { type: 'highlight-id', highlightId: args.highlightId, url },
    };
  }

  if (args.har) {
    const fromHar = await extractTranscriptFromHar(path.resolve(args.har));
    if (fromHar.segments) {
      return fromHar;
    }
    return {
      segments: await fetchTranscriptUrl(fromHar.url),
      info: { type: 'har-url', url: fromHar.url, decodedPayload: fromHar.decodedPayload },
    };
  }

  if (!pageInfo?.episode) {
    throw new Error('Episode metadata is required for the official transcript API.');
  }

  const official = await fetchOfficialTranscript(pageInfo, args);
  return official;
}

async function fetchOfficialTranscript(pageInfo, args, authContext) {
  const episode = pageInfo.episode || {};
  const eid = pageInfo.episodeId || episode.eid;
  const mediaId =
    episode.transcriptMediaId ||
    episode.transcript?.mediaId ||
    episode.media?.id;

  if (!eid || !mediaId) {
    throw new Error('Episode page does not expose the eid/mediaId required by the official transcript API.');
  }

  const credentialsFile = authContext?.credentialsFile || path.resolve(args.credentials || DEFAULT_CREDENTIALS_FILE);
  let credentials = authContext?.credentials || await loadCredentials(credentialsFile);
  credentials = await ensureFreshCredentials(credentials, credentialsFile);
  const { transcriptUrl, credentials: nextCredentials } = await requestTranscriptUrl(
    { eid, mediaId },
    credentials,
    credentialsFile
  );
  if (authContext) {
    authContext.credentials = nextCredentials;
  }

  return {
    segments: await fetchTranscriptUrl(transcriptUrl),
    info: {
      type: 'official-api',
      credentialsFile,
      transcriptUrl,
      mediaId,
    },
  };
}

function parseFormats(formatsArg) {
  if (!formatsArg) {
    return [...ALL_FORMATS];
  }
  const requested = formatsArg
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) {
    throw new Error(`--formats requires at least one of: ${ALL_FORMATS.join(', ')}`);
  }
  const invalid = requested.filter((item) => !ALL_FORMATS.includes(item));
  if (invalid.length) {
    throw new Error(`Unsupported format(s): ${invalid.join(', ')}. Supported: ${ALL_FORMATS.join(', ')}`);
  }
  return [...new Set(requested)];
}

function buildOutputPaths(outDir, baseName, formats) {
  const allPaths = {
    json: path.join(outDir, `${baseName}.json`),
    'raw.json': path.join(outDir, `${baseName}.raw.json`),
    txt: path.join(outDir, `${baseName}.txt`),
    'raw.txt': path.join(outDir, `${baseName}.raw.txt`),
    srt: path.join(outDir, `${baseName}.srt`),
  };
  const selected = {};
  for (const format of formats) {
    selected[format] = allPaths[format];
  }
  return selected;
}

async function saveEpisodeTranscript({ outDir, episode, eid, episodeUrl, rawSegments, transcriptInfo, formats }) {
  const segments = normalizeSegments(rawSegments, { durationSeconds: episode.duration });
  if (!segments.length) {
    throw new Error('Transcript is empty or has an unsupported response shape.');
  }

  const baseName = sanitizeFilename(`${episode.title || 'xiaoyuzhou-transcript'}_${eid}`);
  const metadata = {
    source: 'xiaoyuzhou',
    episodeUrl,
    episodeId: eid,
    title: episode.title || null,
    podcastTitle: episode.podcast?.title || null,
    podcastId: episode.pid || episode.podcast?.pid || null,
    durationSeconds: episode.duration || null,
    pubDate: episode.pubDate || null,
    transcriptMediaId: episode.transcriptMediaId || episode.transcript?.mediaId || null,
    transcriptSource: transcriptInfo,
    segmentCount: segments.length,
  };

  const outputs = buildOutputPaths(outDir, baseName, formats);
  const writers = {
    json: () => fs.writeFile(outputs.json, `${JSON.stringify({ metadata, segments }, null, 2)}\n`, 'utf8'),
    'raw.json': () => fs.writeFile(outputs['raw.json'], `${JSON.stringify(rawSegments, null, 2)}\n`, 'utf8'),
    txt: () => fs.writeFile(outputs.txt, renderTimestampedText(metadata, segments), 'utf8'),
    'raw.txt': () => fs.writeFile(outputs['raw.txt'], `${segments.map((segment) => segment.text).join('\n')}\n`, 'utf8'),
    srt: () => fs.writeFile(outputs.srt, renderSrt(segments), 'utf8'),
  };

  for (const format of formats) {
    await writers[format]();
  }

  return {
    segmentCount: segments.length,
    files: Object.values(outputs),
  };
}

async function allOutputsExist(paths) {
  for (const filePath of paths) {
    try {
      await fs.access(filePath);
    } catch {
      return false;
    }
  }
  return true;
}

async function downloadPodcastBatch(podcastInput, args, formats) {
  const pid = parsePodcastIdInput(podcastInput);
  if (!pid) {
    throw new Error(`Invalid Xiaoyuzhou podcast URL or id: ${podcastInput}`);
  }

  const delayMs = Number.isFinite(args.delay) && args.delay >= 0 ? args.delay : 300;
  const maxEpisodes = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : Infinity;
  const outDir = path.resolve(args.outDir || 'downloads');
  await fs.mkdir(outDir, { recursive: true });

  const credentialsFile = path.resolve(args.credentials || DEFAULT_CREDENTIALS_FILE);
  let credentials = await loadCredentials(credentialsFile);
  credentials = await ensureFreshCredentials(credentials, credentialsFile);
  const authContext = { credentials, credentialsFile };

  const episodes = await fetchPodcastEpisodes(pid, authContext, maxEpisodes);
  console.log(`Found ${episodes.length} episodes for podcast ${pid}.`);

  let downloaded = 0;
  let skipped = 0;
  const unavailable = [];
  const failed = [];

  for (let i = 0; i < episodes.length; i += 1) {
    const ep = episodes[i];
    const eid = ep.eid;
    const label = `[${i + 1}/${episodes.length}] ${ep.title || eid}`;
    const baseName = sanitizeFilename(`${ep.title || 'xiaoyuzhou-transcript'}_${eid}`);
    const outputPaths = Object.values(buildOutputPaths(outDir, baseName, formats));

    if (!args.force && await allOutputsExist(outputPaths)) {
      skipped += 1;
      console.log(`${label} -> SKIP (already exists)`);
      continue;
    }

    const result = await downloadEpisodeWithRetry(ep, args, authContext, outDir, formats);
    if (result.status === 'ok') {
      downloaded += 1;
      console.log(`${label} -> OK (${result.segmentCount} segments)`);
    } else if (result.status === 'unavailable') {
      unavailable.push({ eid, title: ep.title || null, reason: result.error });
      console.log(`${label} -> SKIP (${result.error})`);
    } else {
      failed.push({ eid, title: ep.title || null, error: result.error });
      console.log(`${label} -> FAIL (${result.error})`);
    }

    if (i < episodes.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log('\nBatch summary:');
  console.log(JSON.stringify({
    podcastId: pid,
    total: episodes.length,
    downloaded,
    skipped,
    unavailableCount: unavailable.length,
    failedCount: failed.length,
    unavailable,
    failed,
  }, null, 2));

  if (failed.length && downloaded === 0 && skipped === 0) {
    process.exitCode = 1;
  }
}

async function downloadEpisodeWithRetry(episode, args, authContext, outDir, formats) {
  const eid = episode.eid;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const transcriptSource = await fetchOfficialTranscript({ episodeId: eid, episode }, args, authContext);
      const saved = await saveEpisodeTranscript({
        outDir,
        episode,
        eid,
        episodeUrl: normalizeEpisodeUrl(eid),
        rawSegments: transcriptSource.segments,
        transcriptInfo: transcriptSource.info,
        formats,
      });
      return { status: 'ok', segmentCount: saved.segmentCount };
    } catch (error) {
      const message = error?.message || String(error);
      if (
        message.includes('no available Xiaoyuzhou official transcript') ||
        message.includes('does not expose the eid/mediaId')
      ) {
        return { status: 'unavailable', error: message };
      }
      if (
        attempt < maxAttempts &&
        (message.includes('429') || message.includes('rate limit') || message.includes('fetch failed') || message.includes('ECONNRESET'))
      ) {
        await sleep(attempt * 3000);
        continue;
      }
      return { status: 'failed', error: message };
    }
  }
  return { status: 'failed', error: 'Max retry attempts reached.' };
}

async function fetchPodcastEpisodes(pid, authContext, maxEpisodes = Infinity) {
  const episodes = [];
  let loadMoreKey = undefined;

  while (episodes.length < maxEpisodes) {
    const body = { pid, order: 'desc', limit: 20 };
    if (loadMoreKey) {
      body.loadMoreKey = loadMoreKey;
    }

    let response = await fetch(`${API_BASE_URL}/v1/episode/list`, {
      method: 'POST',
      headers: buildAppHeaders(authContext.credentials),
      body: JSON.stringify(body),
    });

    if (response.status === 401 && authContext.credentials.refreshToken) {
      authContext.credentials = await refreshCredentials(authContext.credentials, authContext.credentialsFile);
      response = await fetch(`${API_BASE_URL}/v1/episode/list`, {
        method: 'POST',
        headers: buildAppHeaders(authContext.credentials),
        body: JSON.stringify(body),
      });
    }

    const text = await response.text();
    if (response.status === 401) {
      throw new Error('Xiaoyuzhou credentials are invalid or expired. Run auth set-token or auth login again.');
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch podcast episodes (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }

    const parsed = safeJson(text);
    const items = Array.isArray(parsed?.data) ? parsed.data : [];
    for (const item of items) {
      episodes.push(item);
      if (episodes.length >= maxEpisodes) {
        break;
      }
    }

    loadMoreKey = parsed?.loadMoreKey;
    if (!loadMoreKey || !items.length) {
      break;
    }
  }

  return episodes;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCredentials(filePath, options = {}) {
  const envCredentials = normalizeCredentials({
    access_token: process.env.XIAOYUZHOU_ACCESS_TOKEN,
    refresh_token: process.env.XIAOYUZHOU_REFRESH_TOKEN,
    expires_at: process.env.XIAOYUZHOU_EXPIRES_AT,
    device_id: process.env.XIAOYUZHOU_DEVICE_ID,
    device_properties: process.env.XIAOYUZHOU_DEVICE_PROPERTIES,
  });

  if (envCredentials.accessToken || envCredentials.refreshToken) {
    return envCredentials;
  }

  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return normalizeCredentials(raw);
  } catch (error) {
    if (options.allowMissing && error.code === 'ENOENT') {
      return null;
    }
    if (error.code === 'ENOENT') {
      throw new Error(
        `Missing Xiaoyuzhou credentials: ${filePath}. ` +
          'Run "node xiaoyuzhou-transcript.mjs auth send-code <phone>" and then ' +
          '"node xiaoyuzhou-transcript.mjs auth login <phone> <sms-code>" once.'
      );
    }
    throw new Error(`Could not read credentials file ${filePath}: ${error.message}`);
  }
}

function normalizeCredentials(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const expiresAtRaw = source.expires_at ?? source.expiresAt;
  const expiresAt = Number(expiresAtRaw);
  const lastUpdated = Number(source.last_updated_ts ?? source.lastUpdatedTs);
  return {
    accessToken: stringOrUndefined(source.access_token ?? source.accessToken),
    refreshToken: stringOrUndefined(source.refresh_token ?? source.refreshToken),
    expiresAt: Number.isFinite(expiresAt)
      ? (expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt)
      : (Number.isFinite(lastUpdated) ? lastUpdated * 1000 + TOKEN_TTL_MS : undefined),
    deviceId: stringOrUndefined(source.device_id ?? source.deviceId) || randomUUID().toUpperCase(),
    deviceProperties: stringOrUndefined(source.device_properties ?? source.deviceProperties),
    uid: stringOrUndefined(source.uid),
    nickname: stringOrUndefined(source.nickname),
  };
}

function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function saveCredentials(credentials, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const body = {
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
    expires_at: credentials.expiresAt,
    device_id: credentials.deviceId,
    device_properties: credentials.deviceProperties || '',
    uid: credentials.uid,
    nickname: credentials.nickname,
  };
  await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function ensureFreshCredentials(credentials, credentialsFile) {
  if (!credentials.refreshToken) {
    if (credentials.accessToken) {
      return credentials;
    }
    throw new Error('Credentials must contain at least refresh_token or access_token.');
  }

  if (!credentials.accessToken || (credentials.expiresAt && Date.now() >= credentials.expiresAt - 60_000)) {
    return refreshCredentials(credentials, credentialsFile);
  }
  return credentials;
}

async function refreshCredentials(credentials, credentialsFile) {
  const response = await fetch(`${API_BASE_URL}/app_auth_tokens.refresh`, {
    method: 'POST',
    headers: buildAppHeaders(credentials, {
      includeRefreshToken: true,
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    }),
  });
  const text = await response.text();
  const body = safeJson(text) || {};

  if (!response.ok) {
    throw new Error(`Xiaoyuzhou token refresh failed with HTTP ${response.status}. Run auth login again.`);
  }

  const next = {
    ...credentials,
    accessToken: response.headers.get('x-jike-access-token') || body['x-jike-access-token'] || body.accessToken,
    refreshToken: response.headers.get('x-jike-refresh-token') || body['x-jike-refresh-token'] || body.refreshToken || credentials.refreshToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  if (!next.accessToken) {
    throw new Error('Xiaoyuzhou token refresh did not return a new access token.');
  }

  await saveCredentials(next, credentialsFile);
  return next;
}

async function requestTranscriptUrl({ eid, mediaId }, credentials, credentialsFile) {
  let activeCredentials = credentials;
  let result = await requestTranscriptUrlOnce({ eid, mediaId }, activeCredentials);
  if (result.status === 401 && activeCredentials.refreshToken) {
    activeCredentials = await refreshCredentials(activeCredentials, credentialsFile);
    result = await requestTranscriptUrlOnce({ eid, mediaId }, activeCredentials);
  }

  if (result.status === 401) {
    throw new Error('Xiaoyuzhou credentials are invalid or expired. Run auth set-token or auth login again.');
  }
  if (result.status === 429) {
    throw new Error('Xiaoyuzhou rate limited the transcript request (HTTP 429). Retry later.');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Official transcript API failed with HTTP ${result.status}: ${result.text.slice(0, 200)}`);
  }

  const parsed = safeJson(result.text);
  const data = parsed?.data?.data && typeof parsed.data.data === 'object' ? parsed.data.data : parsed?.data;
  const transcriptUrl = data?.transcriptUrl || data?.url;
  if (!transcriptUrl) {
    throw new Error('This episode has no available Xiaoyuzhou official transcript.');
  }
  return { transcriptUrl, credentials: activeCredentials };
}

async function requestTranscriptUrlOnce({ eid, mediaId }, credentials) {
  const response = await fetch(`${API_BASE_URL}/v1/episode-transcript/get`, {
    method: 'POST',
    headers: buildAppHeaders(credentials),
    body: JSON.stringify({ eid, mediaId }),
  });
  return {
    status: response.status,
    text: await response.text(),
  };
}

function buildAppHeaders(credentials, options = {}) {
  const headers = {
    host: 'api.xiaoyuzhoufm.com',
    os: 'android',
    'os-version': '28',
    manufacturer: 'Xiaomi',
    model: 'MI 6',
    resolution: '1080x1920',
    market: 'xiaomi',
    applicationid: 'app.podcast.cosmos',
    bundleid: 'app.podcast.cosmos',
    'app-version': '2.99.1',
    'app-buildno': '1362',
    webviewversion: '138.0.7204.179',
    'user-agent': APP_USER_AGENT,
    'app-permissions': '100100',
    wificonnected: 'false',
    timezone: 'Asia/Shanghai',
    'local-time': formatLocalTime(),
    accept: 'application/json, text/plain, */*',
    'content-type': options.contentType || 'application/json;charset=utf-8',
  };
  if (credentials.accessToken) {
    headers['x-jike-access-token'] = credentials.accessToken;
  }
  if (options.includeRefreshToken && credentials.refreshToken) {
    headers['x-jike-refresh-token'] = credentials.refreshToken;
  }
  if (credentials.deviceId) {
    headers['x-jike-device-id'] = credentials.deviceId;
  }
  if (credentials.deviceProperties) {
    headers['x-jike-device-properties'] = credentials.deviceProperties;
  }
  return headers;
}

function formatLocalTime() {
  return `${new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '')}+0800`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function extractTranscriptFromHar(harPath) {
  const har = JSON.parse(await fs.readFile(harPath, 'utf8'));
  const candidates = [];

  for (const entry of har.log?.entries || []) {
    const url = entry.request?.url || '';
    if (!url.includes('transcript-highlight.xyzcdn.net/cdn/episode/get-highlight/')) {
      continue;
    }

    const decodedPayload = decodeHighlightPayloadFromUrl(url);
    const responseText = decodeHarResponseText(entry.response?.content);
    const parsed = parseTranscriptResponse(responseText);
    candidates.push({
      url,
      decodedPayload,
      segments: parsed,
      size: parsed?.length || entry.response?.content?.size || 0,
    });
  }

  if (!candidates.length) {
    throw new Error(`No transcript-highlight request found in HAR: ${harPath}`);
  }

  candidates.sort((a, b) => b.size - a.size);
  const best = candidates[0];
  return {
    segments: best.segments,
    url: best.url,
    decodedPayload: best.decodedPayload,
    info: {
      type: best.segments ? 'har-response' : 'har-url',
      har: harPath,
      url: best.url,
      decodedPayload: best.decodedPayload,
      candidateCount: candidates.length,
    },
  };
}

function decodeHarResponseText(content) {
  if (!content?.text) {
    return null;
  }
  if (content.encoding === 'base64') {
    return Buffer.from(content.text, 'base64').toString('utf8');
  }
  return content.text;
}

function parseTranscriptResponse(text) {
  if (!text) {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data;
    }
    if (Array.isArray(data.data)) {
      return data.data;
    }
    if (Array.isArray(data.data?.sentences)) {
      return data.data.sentences;
    }
    if (Array.isArray(data.data?.segments)) {
      return data.data.segments;
    }
    if (Array.isArray(data.sentences)) {
      return data.sentences;
    }
    if (Array.isArray(data.segments)) {
      return data.segments;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchTranscriptUrl(url) {
  const text = await fetchText(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': APP_USER_AGENT,
      market: 'xiaomi',
    },
  });
  const parsed = parseTranscriptResponse(text);
  if (!parsed) {
    throw new Error(`Transcript URL did not return a supported JSON transcript: ${url}`);
  }
  return parsed;
}

function buildHighlightUrl({ id, edition, key1, key2 }) {
  const payload = Buffer.from(JSON.stringify({ id, edition })).toString('base64url');
  return `https://transcript-highlight.xyzcdn.net/cdn/episode/get-highlight/${payload}` +
    `?KEY1=${encodeURIComponent(key1)}&KEY2=${encodeURIComponent(key2)}`;
}

function decodeHighlightPayloadFromUrl(url) {
  const match = url.match(/\/get-highlight\/([^?/#]+)/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}: ${text.slice(0, 200)}`);
  }
  return text;
}

function resolveTimestampMs(segment, msKeys, fallbackKeys) {
  for (const key of msKeys) {
    if (segment[key] !== undefined && segment[key] !== null && segment[key] !== '') {
      return timestampToMs(segment[key], { assumeMs: true });
    }
  }
  for (const key of fallbackKeys) {
    if (segment[key] !== undefined && segment[key] !== null && segment[key] !== '') {
      return timestampToMs(segment[key]);
    }
  }
  return undefined;
}

function normalizeSegments(rawSegments, options = {}) {
  const episodeDurationMs = Number.isFinite(options.durationSeconds)
    ? Math.round(options.durationSeconds * 1000)
    : undefined;

  return rawSegments
    .map((segment, index) => {
      const text = cleanText(segment.text || joinOffsetWords(segment.offsets) || '');
      const startMs = resolveTimestampMs(
        segment,
        ['startMs', 'beginTime'],
        ['startAt', 'startTime', 'start', 'from', 'offset']
      ) ?? 0;
      const explicitEndMs = resolveTimestampMs(
        segment,
        ['endMs', 'finishTime'],
        ['endAt', 'endTime', 'end', 'to']
      );
      const durationMs = timestampToMs(segment.duration);
      const offsets = Array.isArray(segment.offsets) ? segment.offsets : [];
      const maxOffset = offsets.length
        ? Math.max(
            0,
            ...offsets
              .map((offset) => Number(offset.ts))
              .filter((value) => Number.isFinite(value))
          )
        : 0;
      const hasExplicitEnd = explicitEndMs !== undefined || durationMs !== undefined || offsets.length > 0;
      const computedEndMs = explicitEndMs ??
        (durationMs !== undefined ? startMs + durationMs : startMs + maxOffset + 600);

      return {
        index: index + 1,
        startMs,
        endMs: computedEndMs,
        hasExplicitEnd,
        text,
        offsets,
      };
    })
    .filter((segment) => segment.text)
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment, index, segments) => {
      const next = segments[index + 1];
      let endMs;
      if (segment.hasExplicitEnd) {
        endMs = Math.max(segment.endMs, segment.startMs + 800);
        if (next && endMs >= next.startMs) {
          endMs = Math.max(segment.startMs + 300, next.startMs - 1);
        }
      } else if (next) {
        endMs = Math.max(segment.startMs + 300, next.startMs - 1);
      } else if (episodeDurationMs && episodeDurationMs > segment.startMs) {
        endMs = episodeDurationMs;
      } else {
        endMs = segment.startMs + 5000;
      }
      return {
        index: index + 1,
        startMs: segment.startMs,
        endMs,
        text: segment.text,
        offsets: segment.offsets,
      };
    });
}

function joinOffsetWords(offsets) {
  if (!Array.isArray(offsets)) {
    return '';
  }
  return offsets.map((offset) => offset.word || '').join('');
}

function timestampToMs(value, options = {}) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (options.assumeMs) {
      return Math.round(value);
    }
    return value < 10_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return timestampToMs(Number(trimmed), options);
    }
    const parts = trimmed.split(':').map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      const seconds = parts.reduce((total, part) => total * 60 + part, 0);
      return Math.round(seconds * 1000);
    }
  }
  return undefined;
}

function cleanText(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\p{Script=Han}，。！？；：“”‘’（）《》、])\s+(?=[\p{Script=Han}，。！？；：“”‘’（）《》、])/gu, '')
    .replace(/(?<=[\p{Script=Han}])\s+(?=[，。！？；：、）])/gu, '')
    .replace(/(?<=[（《“‘])\s+(?=[\p{Script=Han}])/gu, '')
    .replace(/(?<=[\p{Script=Han}])\s+(?=[A-Za-z0-9])/gu, '')
    .replace(/(?<=[A-Za-z0-9])\s+(?=[\p{Script=Han}])/gu, '')
    .trim();
}

function renderTimestampedText(metadata, segments) {
  const lines = [
    metadata.title ? `# ${metadata.title}` : '# Xiaoyuzhou Transcript',
    metadata.podcastTitle ? `Podcast: ${metadata.podcastTitle}` : null,
    metadata.episodeUrl ? `URL: ${metadata.episodeUrl}` : null,
    metadata.pubDate ? `Published: ${metadata.pubDate}` : null,
    '',
    ...segments.map((segment) => `[${formatClock(segment.startMs)}] ${segment.text}`),
    '',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

function renderSrt(segments) {
  return `${segments
    .map((segment, index) => {
      return [
        String(index + 1),
        `${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}`,
        segment.text,
      ].join('\n');
    })
    .join('\n\n')}\n`;
}

function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatSrtTime(ms) {
  const safeMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function normalizeEpisodeUrl(input) {
  if (!input) {
    return null;
  }
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  return `https://www.xiaoyuzhoufm.com/episode/${input}`;
}

function extractEpisodeId(input) {
  if (!input) {
    return null;
  }
  const match = String(input).match(/episode\/([a-f0-9]{24})|^([a-f0-9]{24})$/i);
  return match?.[1] || match?.[2] || null;
}

function extractPodcastId(input) {
  if (!input) {
    return null;
  }
  const match = String(input).match(/podcast\/([a-f0-9]{24})/i);
  return match?.[1] || null;
}

function parsePodcastIdInput(input) {
  if (!input) {
    return null;
  }
  const match = String(input).match(/podcast\/([a-f0-9]{24})|^([a-f0-9]{24})$/i);
  return match?.[1] || match?.[2] || null;
}

function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function unescapeHtmlJson(jsonText) {
  return jsonText
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
