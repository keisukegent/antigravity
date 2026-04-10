import fs from 'fs';
import { parse } from 'csv-parse/sync'; // We can use the sync version for initial reading
import { stringify } from 'csv-stringify/sync'; // CSV出力用
import { chromium } from 'playwright';
import pLimit from 'p-limit';

// ==========================================
// 定数定義
// ==========================================
const KEYWORD = 'SA加盟店';
const CONCURRENCY_LIMIT = 5;

// ==========================================
// 1. CSV読み込み (readCsv)
// ==========================================
function readCsv(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  } catch (error) {
    console.error(`CSVファイルの読み込みに失敗しました: ${error.message}`);
    process.exit(1);
  }
}

// ==========================================
// 2. テキスト正規化 (normalizeText)
// ==========================================
function normalizeText(text) {
  if (!text) return '';
  // 改行や複数の空白を単一のスペースに変換し、前後の空白を削除
  return text.replace(/\s+/g, ' ').trim();
}

// ==========================================
// 3. テキスト抜粋 (extractSnippet)
// ==========================================
function extractSnippet(text, keyword) {
  if (!text || !keyword) return '';
  
  const keywordIndex = text.indexOf(keyword);
  if (keywordIndex === -1) return '';
  
  // 前後約30文字を抜粋
  const start = Math.max(0, keywordIndex - 30);
  const end = Math.min(text.length, keywordIndex + keyword.length + 30);
  
  let snippet = text.substring(start, end);
  
  // 最初または最後が途切れている場合は「...」を追加
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}

// ==========================================
// 4. ページ判定 (judgePage)
// ==========================================
async function judgePage(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    console.log(`[アクセス中] ${url}`);
    
    // ページにアクセス。読み込み待ちのタイムアウトは20秒
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    
    // bodyの可視テキストを取得
    const bodyText = await page.locator('body').innerText();
    const normalizedBody = normalizeText(bodyText);
    
    // キーワード判定
    if (normalizedBody.includes(KEYWORD)) {
      return { status: 'SA加盟店あり', text: normalizedBody };
    } else {
      return { status: 'SA加盟店なし', text: normalizedBody };
    }
  } catch (error) {
    console.log(`[エラー] ${url}: ${error.message}`);
    return { status: '判定不可', error: error.message };
  } finally {
    // ページとコンテキストを閉じてメモリ解放
    await page.close();
    await context.close();
  }
}

// ==========================================
// 5. 1行分の処理 (processRow)
// ==========================================
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
    console.log(`[再試行] ${url} - 前回のエラー: ${result.error}`);
    // 少し待機してから再試行（1秒）
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
// 6. CSV書き込み (writeCsv)
// ==========================================
function writeCsv(filePath, records) {
  try {
    const csvContent = stringify(records, { header: true });
    fs.writeFileSync(filePath, csvContent, 'utf-8');
    console.log(`\n結果を ${filePath} に保存しました。`);
  } catch (error) {
    console.error(`CSVファイルの保存に失敗しました: ${error.message}`);
  }
}

// ==========================================
// 実行メイン処理
// ==========================================
async function main() {
  const args = process.argv.slice(2);
  const csvFilePath = args[0] || 'sample-input.csv';

  if (!fs.existsSync(csvFilePath)) {
    console.error(`エラー: ファイル ${csvFilePath} が見つかりません。`);
    process.exit(1);
  }

  console.log(`--- [処理開始] ---`);
  console.log(`対象ファイル: ${csvFilePath}`);

  // 1. CSV読み取り
  const records = readCsv(csvFilePath);
  console.log(`合計 ${records.length} 件のURLを処理します。\n`);

  // 2. Playwrightブラウザの起動
  const browser = await chromium.launch({ headless: true });

  try {
    // 3. 並行処理の制御 (最大5件)
    const limit = pLimit(CONCURRENCY_LIMIT);
    
    const tasks = records.map(row => limit(() => processRow(browser, row)));
    
    // 全件終了まで待機
    const results = await Promise.allSettled(tasks);
    
    // 成功した処理の戻り値を抽出、失敗したものはエラー情報を手動格納
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

    // 4. 結果の出力 (コンソール)
    console.log(`\n--- [処理完了] ---`);
    console.table(
      finalRecords.map(r => ({
        URL: r.url.substring(0, 50) + (r.url.length > 50 ? '...' : ''),
        判定結果: r['判定結果']
      }))
    );
    
    // 5. 結果の出力 (CSV)
    writeCsv('result.csv', finalRecords);
    
  } finally {
    // ブラウザを閉じる
    await browser.close();
  }
}

main().catch(error => {
  console.error("予期せぬエラーが発生しました:", error);
});
