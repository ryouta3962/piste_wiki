
# Piste Wiki 📝

軽量で高速なファイルシステムベースのWikiアプリケーションです。バックエンドにFastAPI、フロントエンドにVanilla JS/CSSを採用したSPA（Single Page Application）構成となっており、データベース不要でシンプルに運用できます。

## ✨ 主な機能

*   **ファイルシステムベース**: 記事やシステムデータはすべて `wiki_data` フォルダ内に保存されます。フォルダごとコピーするだけで簡単にバックアップや移行が可能です。
*   **マークダウンエディタ内蔵**: [EasyMDE](https://github.com/Ionaru/easy-markdown-editor) を採用。プレビューや2画面分割で確認しながら快適に執筆できます。
*   **競合検知＆マージ機能**: 複数人での同時編集による競合（コンフリクト）を検知。差分（Diff）をハイライト表示する専用ウィンドウで、安全に解消・上書き保存ができます。
*   **リアルタイム検索**: ページパスと本文の両方を対象とした高速なインクリメンタルサーチ（AND検索対応）を搭載。
*   **ユーザー管理＆個人最適化**: Basic認証によるログイン機能。ユーザーごとの「お気に入り（ブックマーク）」「最近見たページ」をサイドバーで管理できます。
*   **カスタマイズ可能なサイドバー**: メニューバー自体もWikiの1ページ (`/sidebar`) として自由に編集可能です。
*   **Docker Ready**: `docker-compose` コマンド一つで、環境を汚さずにすぐ立ち上げられます。

## 🚀 クイックスタート

DockerおよびDocker Composeがインストールされている環境であれば、数分で起動できます。

### 1. リポジトリのクローン
```bash
git clone [https://github.com/your-username/your-repo-name.git](https://github.com/your-username/your-repo-name.git)
cd your-repo-name

```

### 2. コンテナの起動

```bash
docker-compose up -d

```

※初回起動時にイメージのビルドが行われます。

### 3. アクセス

ブラウザを開き、以下のURLにアクセスしてください。

* **URL:** `http://localhost:8000`
* **初期ログインID:** `admin`
* **初期パスワード:** `password`

## 📂 ディレクトリ構成

起動後、ホスト側に `wiki_data` が生成され、以下のような構成になります。

```text
.
├── docker-compose.yml
├── Dockerfile
├── main.py               # FastAPI バックエンドサーバー
├── requirements.txt      # 依存パッケージ (fastapi, uvicorn, filelock 等)
├── static/               # フロントエンド静的ファイル
│   ├── global.css
│   ├── global.js
│   └── index.html
└── wiki_data/            # 【自動生成】Wikiデータ（ホストと同期）
    ├── .system/          # ユーザーデータ, 変更履歴ログ(changes.log) 等
    ├── index/            # フロントページ
    └── sidebar/          # サイドバー表示用ページ

```

## 💡 使い方・Tips

* **新しいページの作成**
サイドバーの「📄 新規ページ作成」ボタンをクリックします。入力欄で `./` から始まる名前（例: `./setup`）を入力すると、現在開いているページの階層下にサブページとして作成されます。
* **メニューの編集**
サイドバー右下の「✏️ メニューを編集」をクリックすると、サイドバーの内容を直接書き換えることができます。
* **ユーザーの追加**
システムにログイン後、サイドバーの「👥 ユーザー追加」から新しいアカウントを発行できます。
* **別ユーザーへの切り替え**
サイドバー最下部の「🚪 ログアウト」ボタンから、ブラウザのキャッシュをクリアして別のアカウントで再ログインできます。

## 🛠️ 技術スタック

* **Backend:** Python 3.11, FastAPI, Uvicorn, FileLock (スレッドセーフなファイル操作用)
* **Frontend:** HTML5, CSS3, Vanilla JavaScript
* **Markdown Rendering:** EasyMDE, marked.js, DOMPurify (XSS対策)
* **Diff & Patch:** diff-match-patch (Google)
* **Infrastructure:** Docker, Docker Compose

## 📄 ライセンス

