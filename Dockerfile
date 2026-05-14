# 軽量でセキュアな slim イメージを使用
FROM python:3.11-slim

# 作業ディレクトリの設定
WORKDIR /app

# 依存ライブラリのリストをコンテナにコピー
COPY requirements.txt .

# パッケージのインストール
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションのコードをコンテナにコピー
# (wiki_dataフォルダは後でボリュームマウントするので、ここでのコピーには含まれなくても大丈夫です)
COPY . .

# FastAPI（Uvicorn）を起動するコマンド
# ホストを0.0.0.0にしてコンテナ外部からアクセスできるようにします
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000" , "--reload"]