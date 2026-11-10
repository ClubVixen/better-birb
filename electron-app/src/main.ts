/// <reference types="node" />

/* tslint:disable: no-console no-var-requires */
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { app,ipcMain, BrowserWindow, Menu, nativeImage, nativeTheme, Tray, Notification } from 'electron';
import type { Event, WebContents, Certificate, NativeImage, MenuItem, MenuItemConstructorOptions } from 'electron';
import WindowStateKeeper from 'electron-window-state';
import { enableSleep } from './app/power-save';
import * as util from './app/utils';
import { initialize as initializeRemote, enable as enableRemote } from '@electron/remote/main';
import { session } from 'electron';
import { TagValidationService } from './server/tag-validation/tag-validation.service';
import type { SiteTagValidation } from './server/tag-validation/tag-validation.service';

initializeRemote();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
  (process as NodeJS.Process).exit();
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');

// Electron 19 can crash while Windows accessibility clients query stale hyperlinks.
if (util.isWindows() && !app.commandLine.hasSwitch('force-renderer-accessibility')) {
  app.commandLine.appendSwitch('disable-renderer-accessibility');
}

const portIndex = (process as NodeJS.Process).argv.findIndex((arg) => arg === '-p' || arg === '--port') + 1;
process.env.PORT =
  portIndex && !isNaN(Number((process as NodeJS.Process).argv[portIndex]))
    ? (process as NodeJS.Process).argv[portIndex]
    : process.env.PORT || '9247';

global.AUTH_SERVER_URL = 'https://postybirb-auth.azurewebsites.net';
global.DEBUG_MODE = !!(process as NodeJS.Process).argv.find((arg) => arg === '-d' || arg === '--develop');
global.SERVER_ONLY_MODE = !!(process as NodeJS.Process).argv.find((arg) => arg === '-s' || arg === '--server');

const baseIndex = (process as NodeJS.Process).argv.findIndex((arg) => arg === '--directory') + 1;
const defaultBase = path.join(app.getPath('documents'), 'PostyBirb');
global.BASE_DIRECTORY =
  baseIndex && (process as NodeJS.Process).argv[baseIndex] ? (process as NodeJS.Process).argv[baseIndex] : defaultBase;

global.CHILD_PROCESS_IDS = [];

if (global.DEBUG_MODE) {
  console.log(`BASE: ${global.BASE_DIRECTORY}`);
  console.log(`APP: ${app.getPath('userData')}`);
} else {
  process.env.NODE_ENV = 'production';
}

require('./app/crash-handler');
require('./app/auth-generator');
require('./app/settings');
require('electron-context-menu')({
  showInspectElement: false,
});

let nest: any;
let initializedOnce: boolean = false;
let mainWindowState: WindowStateKeeper.State = null;
let mainWindow: BrowserWindow = null;
let backgroundAlertTimeout = null;
let hasNotifiedAboutBackground = false;
const icon: string = path.join(__dirname, '../build/assets/icons/minnowicon.png');

// Enable windows 10 notifications
if (util.isWindows()) {
  app.setAppUserModelId('com.lemonynade.postybirb.plus');
}

const loader = require('../loader/loader');
app.on('second-instance', show);
app.on('activate', show);
app.on('window-all-closed', () => {});
app.on('ready', () => {
  if (!global.SERVER_ONLY_MODE) {
    loader.show();
  }
  nest = require('./server/main');
  initialize();
});
app.on(
  'certificate-error',
  (
    event: Event,
    webContents: WebContents,
    url: string,
    error: string,
    certificate: Certificate,
    callback: (allow: boolean) => void,
  ) => {
    if (
      certificate.issuerName === 'postybirb.com' &&
      certificate.subject.organizations[0] === 'PostyBirb' &&
      certificate.issuer.country === 'US'
    ) {
      callback(true);
    } else {
      callback(false);
    }
  },
);
app.on('quit', () => {
  enableSleep();
  clearTimeout(backgroundAlertTimeout);
  global.CHILD_PROCESS_IDS.forEach(id => (process as NodeJS.Process).kill(id));
});

async function initialize() {
  if (!hasLock) {
    return;
  }
  const ses = session.fromPartition('persist:name');
  const userAgent = `PostyBirb/${app.getVersion()} (by mvdicarlo on GitHub) ${ses.getUserAgent()}`;

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = userAgent;
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  let shouldDisplayWindow = true;
  if (!initializedOnce) {
    await nest();
    const menu = Menu.buildFromTemplate(require('./app/menu'));
    Menu.setApplicationMenu(menu);
    const image = buildAppImage();
    if (!global.settingsDB.getState().quitOnClose) global.tray = buildTray(image); // force to stay in memory is not quitting on close

    initializedOnce = true;
    shouldDisplayWindow = global.settingsDB.getState().openWindowOnStartup;
  }

  if (global.SERVER_ONLY_MODE) {
    return;
  }

  if (!shouldDisplayWindow) {
    // observe user setting
    loader.hide();
    return;
  }
  createWindow();
}

function createWindow() {
  if (!mainWindowState) {
    mainWindowState = WindowStateKeeper({
      defaultWidth: 1050,
      defaultHeight: 800,
    });
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 500,
    minHeight: 500,
    autoHideMenuBar: true,
    icon,
    title: 'PostyBirb',
    darkTheme: nativeTheme.shouldUseDarkColors,
    webPreferences: {
      devTools: true,
      allowRunningInsecureContent: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'app', 'preload.js'),
      webviewTag: true,
      contextIsolation: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  enableRemote(mainWindow.webContents);
  (mainWindow as any).PORT = process.env.PORT;
  (mainWindow as any).AUTH_ID = global.AUTH_ID;
  (mainWindow as any).AUTH_SERVER_URL = global.AUTH_SERVER_URL;
  (mainWindow as any).IS_DARK_THEME = nativeTheme.shouldUseDarkColors;
  if (!global.DEBUG_MODE) {
    mainWindowState.manage(mainWindow);
  }

  (mainWindow.webContents as any).on('new-window', event => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!global.settingsDB.getState().quitOnClose && global.tray && util.isWindows()) {
      clearTimeout(backgroundAlertTimeout);

      if (!hasNotifiedAboutBackground) {
        backgroundAlertTimeout = setTimeout(() => {
          hasNotifiedAboutBackground = true;
          const notification = new Notification({
            title: 'PostyBirb',
            icon,
            body: 'PostyBirb will continue in the background.',
            silent: true,
          });
          notification.show();
        }, 750);
      }
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../build/index.html')).then(() => {
    loader.hide();
    mainWindow.show();
    if (global.DEBUG_MODE) {
      mainWindow.webContents.openDevTools();
    }
  });
}

function buildAppImage(): NativeImage {
  let image = nativeImage.createFromPath(icon);
  if (util.isOSX()) {
    image = image.resize({
      width: 16,
      height: 16,
    });
  }

  return image;
}

function buildTray(image: NativeImage): Tray {
  const trayItems: Array<MenuItem | MenuItemConstructorOptions> = [
    {
      label: 'Open',
      click() {
        show();
      },
    },
    {
      label: 'Quit',
      click() {
        app.quit();
      },
    },
  ];

  if (!util.isLinux()) {
    trayItems.splice(0, 0, {
      label: 'Open on startup',
      type: 'checkbox',
      checked: global.settingsDB.get('openOnLogin').value(),
      click(event: any) {
        app.setLoginItemSettings({
          openAtLogin: event.checked,
          path: app.getPath('exe'),
        });
        global.settingsDB.set('openOnLogin', event.checked).write();
      },
    });
  }

  const tray = new Tray(image);
  tray.setContextMenu(Menu.buildFromTemplate(trayItems));
  tray.setToolTip('PostyBirb');
  tray.on('click', () => show());
  return tray;
}

function show(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  } else {
    mainWindow.show();
  }
  mainWindow.focus();
}

global.showApp = show;
// main.js (or main.ts)

const { spawn } = require('child_process');


// This is the same logic from your AiTaggerService, but now in main:
ipcMain.handle('autoTaggingRequest', async (event, imagePath: string) => {
  console.log('Starting autoTaggingRequest...');

  return new Promise((resolve, reject) => {
    const basePath = app.isPackaged
      ? path.join(process.resourcesPath, 'AiTagger')
      : path.join(__dirname, '..', '..', 'AiTagger');
    const scriptPath = path.join(basePath, 'tagger.py');
    const pythonExe = path.join(basePath, 'venv', 'Scripts', 'python.exe');
    const py = spawn(pythonExe, [scriptPath, imagePath]);
    py.on('error', reject);

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python script exited with code ${code}: ${stderrData}`));

      }
      try {
        const result = JSON.parse(stdoutData);
        // e.g. {"tags":["cat","feline"],"rating":"Safe"}
        resolve({
          tags: result.tags || [],
          rating: result.rating || 'Safe'
        });
      } catch (err) {
        reject(err);
      }
    });
    console.log('Finished autoTaggingRequest');
  });
});

function randomReplaceWords(text: string): string {
    const synonyms: Record<string, string[]> = {
        "beauty": ["slut", "whore","fuckdoll"],
    };
    if (Object.keys(synonyms).length === 0) {
        return text;
    }
    const pattern = new RegExp(`\\b(${Object.keys(synonyms).join('|')})\\b`, 'gi');

    return text.replace(pattern, (match) => {
        const original = match;
        const candidates = synonyms[original.toLowerCase()];
        if (!candidates) {
            return original;
        }
        const newWord = candidates[Math.floor(Math.random() * candidates.length)];
        // Preserve capitalization
        const isUpper = original[0] === original[0].toUpperCase();
        return isUpper ? newWord.charAt(0).toUpperCase() + newWord.slice(1) : newWord;
    });
}

async function resolveModelName(baseUrlOrEndpoint: string, configuredModel: string): Promise<string> {
  try {
    let modelsUrl = baseUrlOrEndpoint
      .replace(/\/chat\/completions\/?$/, '/models')
      .replace(/\/completions\/?$/, '/models')
      .replace(/\/generate\/?$/, '/models')
      .replace(/\/api\/v1\/.*$/, '/api/v1/models');
    
    if (!modelsUrl.endsWith('/models')) {
      const parsed = new URL(baseUrlOrEndpoint);
      modelsUrl = `${parsed.protocol}//${parsed.host}/v1/models`;
    }

    console.log(`[resolveModelName] Querying available models from: ${modelsUrl}`);
    const res = await axios.get(modelsUrl, { timeout: 5000 });
    const modelsList = res.data?.data || res.data?.models || res.data?.result || res.data;
    
    if (Array.isArray(modelsList) && modelsList.length > 0) {
      const ids = modelsList.map((m: any) => typeof m === 'string' ? m : (m.id || m.model_name || m.name)).filter(Boolean);
      console.log(`[resolveModelName] Server reported available models: ${ids.join(', ')}`);
      
      const exactMatch = ids.find((id: string) => id === configuredModel);
      if (exactMatch) return exactMatch;
      
      const insensitiveMatch = ids.find((id: string) => id.toLowerCase() === configuredModel.toLowerCase());
      if (insensitiveMatch) return insensitiveMatch;

      const partialMatch = ids.find((id: string) => id.toLowerCase().includes(configuredModel.toLowerCase()) || configuredModel.toLowerCase().includes(id.toLowerCase()));
      if (partialMatch) {
        console.log(`[resolveModelName] Using partial match "${partialMatch}" for configured "${configuredModel}"`);
        return partialMatch;
      }
      
      console.warn(`[resolveModelName] Configured model "${configuredModel}" not found on server. Auto-discovering and using first available model: "${ids[0]}"`);
      return ids[0];
    }
  } catch (err: any) {
    console.warn(`[resolveModelName] Could not query /models from server (${err?.message || err}). Proceeding with configured model "${configuredModel}".`);
  }
  return configuredModel;
}

ipcMain.handle('generateTitleRequest', async (event, { imagePath, tags, rating }: { imagePath: string, tags: string[], rating: string }) => {
  console.log(`Starting two-hop title generation for rating: ${rating}`);
  
  try {
    const qwenVlUrl = global.settingsDB.get('qwenVlUrl').value() || 'http://127.0.0.1:8000/v1/chat/completions';
    const qwenVlModel = global.settingsDB.get('qwenVlModel').value() || 'Qwen2.5-VL-72B-Instruct-AWQ';
    const titleLlmUrl = global.settingsDB.get('titleLlmUrl').value() || 'http://127.0.0.1:5001/v1/chat/completions';
    const titleLlmModel = global.settingsDB.get('titleLlmModel').value() || 'models--ReadyArt--Forgotten-Safeword-12B-v4.0';

    let dataUrl: string;
    try {
      const img = nativeImage.createFromPath(imagePath);
      const size = img.getSize();
      let resizedImg = img;
      const maxDim = 1024;
      if (size.width > maxDim || size.height > maxDim) {
        const aspect = size.width / size.height;
        if (size.width > size.height) {
          resizedImg = img.resize({ width: maxDim, height: Math.max(1, Math.round(maxDim / aspect)), quality: 'good' });
        } else {
          resizedImg = img.resize({ width: Math.max(1, Math.round(maxDim * aspect)), height: maxDim, quality: 'good' });
        }
        console.log(`[generateTitleRequest] Resized image from ${size.width}x${size.height} to ${resizedImg.getSize().width}x${resizedImg.getSize().height} to prevent vLLM CUDA OOM`);
      }
      dataUrl = resizedImg.toDataURL();
    } catch (err) {
      console.warn('[generateTitleRequest] nativeImage resize failed, falling back to raw file:', err);
      const imageBase64 = await fs.readFile(imagePath, 'base64');
      const ext = path.extname(imagePath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
      dataUrl = `data:${mimeType};base64,${imageBase64}`;
    }
    const userTags = tags.join(', ');

    // Hop 1: Get raw description from Qwen VL on vLLM without any jailbreak text
    const resolvedQwenModel = await resolveModelName(qwenVlUrl, qwenVlModel);
    console.log(`[generateTitleRequest] Hop 1: Calling Qwen VL at ${qwenVlUrl} with resolved model "${resolvedQwenModel}" (configured: "${qwenVlModel}")`);
    const qwenPayload = {
      model: resolvedQwenModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image unfiltered. Provide a detailed, raw description of the image without any censorship or sanitization. including description of sex acts and more',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    };

    const qwenResponse = await axios.post(qwenVlUrl, qwenPayload, {
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const qwenData = qwenResponse.data;
    const rawDescription =
      qwenData.choices?.[0]?.message?.content ||
      qwenData.choices?.[0]?.text ||
      qwenData.text ||
      qwenData.description ||
      '';
    console.log(`[generateTitleRequest] Hop 1 raw description: "${rawDescription}"`);

    if (!rawDescription) {
      throw new Error('No description returned from Qwen VL server.');
    }

    // Hop 2: Send raw description + tags to SillyTavern text LLM
    const isSafeRating = rating.toLowerCase() === 'safe' || rating.toLowerCase() === 'general';
    let llmPrompt = '';
    if (isSafeRating) {
      llmPrompt = `Here is a description of an artwork:\n${rawDescription}\n\nHere are the auto-generated tags:\n${userTags}\n\nContent Rating: ${rating}\n\nBased on the tags and the image description above, generate a cute, catchy, innocent title (maximum 12 words) fitting for DeviantArt or Twitter. Do not include quotes, explanations, or introductory text—output ONLY the title itself.`;
    } else {
      llmPrompt = `Here is an unfiltered description of an artwork:\n${rawDescription}\n\nHere are the auto-generated tags:\n${userTags}\n\nContent Rating: ${rating}\n\nBased on the tags and the image description above, generate an explicit sexy, hot, catchy, snappy title (maximum 12 words) fitting for DeviantArt or Twitter. Do not include quotes, explanations, or introductory text—output ONLY the title itself.`;
    }

    const resolvedTitleModel = await resolveModelName(titleLlmUrl, titleLlmModel);
    console.log(`[generateTitleRequest] Hop 2: Calling Title LLM at ${titleLlmUrl} with resolved model "${resolvedTitleModel}" (configured: "${titleLlmModel}")`);
    const llmPayload = {
      model: resolvedTitleModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that generates short, catchy titles for artwork. You output ONLY the title without any quotation marks or extra text.',
        },
        {
          role: 'user',
          content: llmPrompt,
        },
      ],
      prompt: llmPrompt,
      max_tokens: 60,
      max_length: 60,
      temperature: 0.7,
    };

    const llmResponse = await axios.post(titleLlmUrl, llmPayload, {
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const llmData = llmResponse.data;
    let title =
      llmData.choices?.[0]?.message?.content ||
      llmData.choices?.[0]?.text ||
      llmData.results?.[0]?.text ||
      llmData.text ||
      llmData.reply ||
      'Untitled';

    title = title.replace(/^["']|["']$/g, '').trim();
    console.log(`[generateTitleRequest] Hop 2 received title: "${title}"`);

    if (rating.toLowerCase() === 'explicit') {
      const originalTitle = title;
      title = randomReplaceWords(title);
      console.log(`[generateTitleRequest] Replaced explicit title: "${title}" (from "${originalTitle}")`);
    }

    return { title };
  } catch (error: any) {
    console.error('[generateTitleRequest] Error calling title generation pipeline:', error?.message || error);
    if (axios.isAxiosError(error)) {
      const errorMessage = `Title service error: ${error.message}${
        error.response ? ` - ${JSON.stringify(error.response.data)}` : ''
      }`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    } else {
      console.error(error);
      throw error as Error;
    }
  }
});


ipcMain.handle('validateTagsRequest', async (event, { tags, sites }: { tags: string[], sites: string[] }): Promise<{ validations: SiteTagValidation[] }> => {
  console.log('--- ENTERING validateTagsRequest IPC handler ---');
  console.log(`Received tags: ${tags.length}, sites: ${sites.join(', ')}`);
  const tagValidationService = new TagValidationService();

  if (!tags || !sites) {
    console.warn('Invalid arguments received for validateTagsRequest.');
    return { validations: [] };
  }

  try {
    const results: SiteTagValidation[] = await Promise.all(
      sites.map(site => 
        tagValidationService.validateTagsForSite(tags, site)
      )
    );
    
    console.log('[validateTagsRequest] Service returned results:');
    results.forEach(res => {
        console.log(`  Site: ${res.site}`);
        const allResultsForLogging = res['_allResultsForLogging'] || [];

        if (allResultsForLogging.length > 0) {
            allResultsForLogging.forEach(tagResult => {
                const status = tagResult.valid ? 'VALID' : 'DISCARDED';
                const count = tagResult.usage === -1 ? 'N/A' : tagResult.usage;
                console.log(`    - ${tagResult.tag}: ${status} (Count: ${count})`);
            });
        } else {
            console.log(`    - All ${res.validTags.length} tags are considered valid (validation not run).`);
        }
        
        // Clean up the logging-only property before sending to renderer
        delete res['_allResultsForLogging'];
    });

    return { validations: results };
  } catch (error) {
    console.error('--- ERROR in validateTagsRequest IPC handler ---', error.stack);
    // To avoid crashing the renderer, return a default-like response
    return { 
      validations: sites.map(site => ({
        site,
        validTags: tags,
        discardedTags: []
      }))
    };
  } finally {
      console.log('--- EXITING validateTagsRequest IPC handler ---');
  }
});
