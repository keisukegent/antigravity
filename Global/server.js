import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { chromium } from 'playwright';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ==========================================
// ミドルウェア設定
// ==========================================
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
// Multer: アップロードされたファイルをメモリ上で保持
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 判定用ロジック (元の index.js から移植)
// ==========================================
const KEYWORD = 'SA加盟店';
const CONCURRENCY_LIMIT = 5;

function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function extractSnippet(text, keyword) {
  if (!text || !keyword) return '';
  const keywordIndex = text.indexOf(keyword);
  if (keywordIndex === -1) return '';
  const start = Math.max(0, keywordIndex - 30);
  const end = Math.min(text.length, keywordIndex + keyword.length + 30);
  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

async function judgePage(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    const bodyText = await page.locator('body').innerText();
    const normalizedBody = normalizeText(bodyText);
    
    if (normalizedBody.includes(KEYWORD)) {
      return { status: 'SA加盟店あり', text: normalizedBody };
    } else {
      return { status: 'SA加盟店なし', text: normalizedBody };
    }
  } catch (error) {
    return { status: '判定不可', error: error.message };
  } finally {
    await page.close();
    await context.close();
  }
}

async function processRow(browser, row) {
  const url = row.url;
  const baseResult = {
    ...row,
    '判定結果': '',
    '検出キーワード': '',
    '検出テキスト抜粋': '',
    'エラー内容': '',
    '処理時刻': new Date().toLocaleString('ja-JP')
  };

  if (!url) {
    return { ...baseResult, '判定結果': '判定不可', 'エラー内容': 'URLがありません' };
  }
  
  let result = await judgePage(browser, url);
  
  // 1回だけ自動再試行
  if (result.status === '判定不可') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await judgePage(browser, url);
  }
  
  let snippet = '';
  if (result.status === 'SA加盟店あり') {
    snippet = extractSnippet(result.text, KEYWORD);
  }

  return {
    ...baseResult,
    '判定結果': result.status,
    '検出キーワード': result.status === 'SA加盟店あり' ? KEYWORD : '',
    '検出テキスト抜粋': snippet,
    'エラー内容': result.error || ''
  };
}

// ==========================================
// API エンドポイント
// ==========================================
app.post('/api/check', upload.single('csvFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('CSVファイルがアップロードされていません。');
    }

    let records;
    try {
        const fileContent = req.file.buffer.toString('utf-8');
        // bom: true でExcelのBOM付きUTF-8に対応。trim: true で余分な空白を除去
        records = parse(fileContent, { columns: true, skip_empty_lines: true, bom: true, trim: true });
    } catch (e) {
        console.error('[APIエラー] CSV解析失敗:', e.message);
        return res.status(400).send('CSVファイルの解析に失敗しました。ファイル形式が正しいか確認してください。');
    }

    // URL列を探す（url, URL, Url, 加盟店URL など「url」という文字が含まれる列を自動判別）
    if (records.length > 0) {
        const headers = Object.keys(records[0]);
        // 完全に 'url' なものを優先し、見つからなければ名前に 'url' や 'ＵＲＬ' が含まれる列を探す
        const urlKey = headers.find(k => k.toLowerCase() === 'url') || 
                       headers.find(k => k.toLowerCase().includes('url') || k.includes('ＵＲＬ'));
        
        if (urlKey && urlKey !== 'url') {
            records = records.map(row => {
                row.url = row[urlKey];
                return row;
            });
        }
    }

    if (records.length === 0 || !records[0].url) {
        const headers = records.length > 0 ? Object.keys(records[0]).join(', ') : 'なし';
        console.error('[APIエラー] URL列がないかデータが空です。検出された列:', headers);
        return res.status(400).send(`CSVの1行目に「url」という名前の列が見つかりません。（検出された列: ${headers}）`);
    }

    console.log(`[API] 処理リクエストを受信しました。件数: ${records.length}件`);

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const limit = pLimit(CONCURRENCY_LIMIT);
        
        const tasks = records.map(row => limit(() => processRow(browser, row)));
        const results = await Promise.allSettled(tasks);
        
        const finalRecords = results.map((r, i) => {
            if (r.status === 'fulfilled') {
                return r.value;
            } else {
                return {
                    ...records[i],
                    '判定結果': 'システムエラー',
                    'エラー内容': r.reason.message,
                    '処理時刻': new Date().toLocaleString('ja-JP')
                };
            }
        });

        const outputCsv = stringify(finalRecords, { header: true });
        
        // ヘッダーを設定してCSVをダウンロードファイルとしてレスポンスに返す
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="result.csv"');
        res.send(outputCsv);
        
        console.log(`[API] 全件処理が完了し、レスポンスを返しました。`);

    } catch (error) {
        console.error(`[APIエラー] ${error.message}`);
        res.status(500).send('サーバー内部エラーが発生しました。');
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// ==========================================
// サーバー起動
// ==========================================
app.listen(port, () => {
  console.log(`サーバーを起動しました🚀`);
  console.log(`ブラウザで http://localhost:${port} を開いてください。`);
});
