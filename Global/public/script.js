const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('csv-file');
const loadingZone = document.getElementById('loading');
const resultZone = document.getElementById('result');
const resetBtn = document.getElementById('reset-btn');

// ==========================================
// イベントリスナーの登録
// ==========================================

// LabelやInput自体がクリックされた時は標準動作を優先して二重発火を防ぐ
dropZone.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') {
        return;
    }
    fileInput.click();
});

// 連続で同じファイルを選択しても反応するように、クリックされた瞬間に値をクリアする
fileInput.addEventListener('click', () => {
    fileInput.value = '';
});

// ファイルが選択された時
fileInput.addEventListener('change', handleFileSelect);

// ドラッグ＆ドロップイベント
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', handleDrop, false);

// リセットボタン
resetBtn.addEventListener('click', () => {
    resultZone.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
});

// ==========================================
// 処理関数
// ==========================================

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
        processFile(files[0]);
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

async function processFile(file) {
    // 拡張子チェック
    if (!file.name.endsWith('.csv')) {
        alert('CSVファイルのみ対応しています！');
        return;
    }

    // UIの切り替え
    dropZone.classList.add('hidden');
    loadingZone.classList.remove('hidden');

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
        // バックエンドへ送信
        const response = await fetch('/api/check', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${errorText} (ステータス: ${response.status})`);
        }

        // CSVファイルとしてダウンロード
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `result_${Date.now()}.csv`;
        
        // 自動ダウンロードのトリガー
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // 成功画面へ
        loadingZone.classList.add('hidden');
        resultZone.classList.remove('hidden');

    } catch (error) {
        alert(`申し訳ありません！エラーが発生しました: ${error.message}`);
        loadingZone.classList.add('hidden');
        dropZone.classList.remove('hidden');
    }
}
