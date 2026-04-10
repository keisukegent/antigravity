# 安定したNode.js環境を使用
FROM node:20-bookworm

# 作業ディレクトリの設定
WORKDIR /app

# 先にパッケージ群をコピーしてインストール
COPY package*.json ./
RUN npm install

# Playwrightと、それに必要なOSの部品を一括インストール
RUN npx playwright install --with-deps chromium

# アプリケーション全体をコピー
COPY . .

# アプリケーションの起動
CMD ["node", "server.js"]
