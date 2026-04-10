# Playwrightの公式イメージを使用 (必要なブラウザ環境がすべて含まれています)
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# 作業ディレクトリの設定
WORKDIR /app

# パッケージファイルのコピーとインストール
COPY package*.json ./
RUN npm install

# アプリケーションのすべてのファイルをコピー
COPY . .

# アプリケーションの起動
CMD ["node", "server.js"]
