from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
import os
import json
import time
from diff_match_patch import diff_match_patch
from filelock import FileLock

app = FastAPI()
security = HTTPBasic()

# ==========================================
# 0. 初期設定とヘルパー関数
# ==========================================
BASE_DIR = "wiki_data"
SYSTEM_DIR = f"{BASE_DIR}/.system"

os.makedirs(f"{SYSTEM_DIR}/user_data", exist_ok=True)
users_file = f"{SYSTEM_DIR}/users.json"
if not os.path.exists(users_file):
    with open(users_file, "w", encoding="utf-8") as f:
        json.dump({"admin": {"password": "password", "display_name": "管理者"}}, f)

# ★ フロントページがなければ自動作成
if not os.path.exists(f"{BASE_DIR}/index/index.md"):
    os.makedirs(f"{BASE_DIR}/index", exist_ok=True)
    with open(f"{BASE_DIR}/index/index.md", "w", encoding="utf-8") as f:
        f.write("# Welcome to Piste Wiki\n\nフロントページへようこそ！\n\n- 右上の **「編集」** ボタンからこのページを書き換えられます。\n- 左の **「新規ページ作成」** ボタンから新しいページを作れます。")
    # ★追加: 空のアセットファイルを作成
    with open(f"{BASE_DIR}/index/index.css", "w", encoding="utf-8") as f:
        f.write("/* ページ専用CSS */\n")
    with open(f"{BASE_DIR}/index/index.js", "w", encoding="utf-8") as f:
        f.write("// ページ専用JS\n")

if not os.path.exists(f"{BASE_DIR}/sidebar/index.md"):
    os.makedirs(f"{BASE_DIR}/sidebar", exist_ok=True)
    with open(f"{BASE_DIR}/sidebar/index.md", "w", encoding="utf-8") as f:
        f.write("### メインメニュー\n\n"
                "- [ホーム](/index)\n"
                "- [カスタムJSの書き方](/manual/js)\n\n"
                "---\n"
                "*※ここは自由に書き換えられます。*")
    # ★追加: 空のアセットファイルを作成
    with open(f"{BASE_DIR}/sidebar/index.css", "w", encoding="utf-8") as f:
        f.write("")
    with open(f"{BASE_DIR}/sidebar/index.js", "w", encoding="utf-8") as f:
        f.write("")

def get_current_username(credentials: HTTPBasicCredentials = Depends(security)):
    with open(users_file, "r", encoding="utf-8") as f:
        users = json.load(f)
    user = users.get(credentials.username)
    if not user or user["password"] != credentials.password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password", headers={"WWW-Authenticate": "Basic"})
    return credentials.username

def append_changelog(username: str, filepath: str):
    log_file = f"{SYSTEM_DIR}/changes.log"
    lock_file = f"{SYSTEM_DIR}/changes.log.lock"
    with FileLock(lock_file, timeout=5):
        with open(log_file, "a", encoding="utf-8") as f:
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"{now}\t{username}\t{filepath}\n")

def get_user_data(username: str):
    path = f"{SYSTEM_DIR}/user_data/{username}/data.json"
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"bookmarks": [], "view_history": []}

def save_user_data(username: str, data: dict):
    dir_path = f"{SYSTEM_DIR}/user_data/{username}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ==========================================
# 1. Wikiページ管理 API (必ず SPAルーティング より上に書く)
# ==========================================
class SavePageRequest(BaseModel):
    base_text: str
    new_text: str
    force: bool = False

@app.get("/api/pages/{page_path:path}")
def get_page(page_path: str):
    target_dir = f"{BASE_DIR}/{page_path}"
    target_file = f"{target_dir}/index.md"
    conflict_file = f"{target_dir}/_conflicted.md"
    
    content = ""
    if os.path.exists(target_file):
        with open(target_file, "r", encoding="utf-8") as f:
            content = f.read()
            
    return {"content": content, "has_conflict": os.path.exists(conflict_file)}

@app.post("/api/save/{page_path:path}")
def save_page(page_path: str, req: SavePageRequest, username: str = Depends(get_current_username)):
    target_dir = f"{BASE_DIR}/{page_path}"
    target_file = f"{target_dir}/index.md"
    lock_file = f"{target_dir}/index.md.lock"
    conflict_file = f"{target_dir}/_conflicted.md"
    
    os.makedirs(target_dir, exist_ok=True)

    # ★追加: ページ専用のCSS/JSが存在しなければ空ファイルを作成
    if not os.path.exists(f"{target_dir}/index.css"):
        with open(f"{target_dir}/index.css", "w", encoding="utf-8") as f:
            f.write("")
    if not os.path.exists(f"{target_dir}/index.js"):
        with open(f"{target_dir}/index.js", "w", encoding="utf-8") as f:
            f.write("")
    
    with FileLock(lock_file, timeout=10):
        # ★追加: forceフラグがTrueなら、マージをスキップして強制上書きする
        if req.force:
            with open(target_file, "w", encoding="utf-8") as f:
                f.write(req.new_text)
            append_changelog(username, page_path)
            # コンフリクト退避ファイルを消す
            if os.path.exists(conflict_file):
                os.remove(conflict_file)
            return {"status": "success", "message": "Force saved successfully"}

        # (以下、既存のマージ処理)
        current_text = ""
        if os.path.exists(target_file):
            with open(target_file, "r", encoding="utf-8") as f:
                current_text = f.read()
        
        dmp = diff_match_patch()
        diffs = dmp.diff_main(req.base_text, req.new_text)
        dmp.diff_cleanupSemantic(diffs)
        patches = dmp.patch_make(req.base_text, diffs)
        merged_text, results = dmp.patch_apply(patches, current_text)
        
        if all(results):
            with open(target_file, "w", encoding="utf-8") as f:
                f.write(merged_text)
            append_changelog(username, page_path)
            return {"status": "success", "message": "Saved successfully"}
        else:
            conflict_lock = f"{target_dir}/_conflicted.md.lock"
            with FileLock(conflict_lock, timeout=5):
                with open(conflict_file, "a", encoding="utf-8") as f:
                    now = time.strftime("%Y-%m-%d %H:%M:%S")
                    f.write(f"\n\n### [競合] {now} - {username} のテキスト\n{req.new_text}\n")
            
            return {
                "status": "conflict", 
                "message": "Conflict occurred.",
                "server_text": current_text
            }

@app.delete("/api/conflicts/{page_path:path}")
def clear_conflict(page_path: str, username: str = Depends(get_current_username)):
    conflict_file = f"{BASE_DIR}/{page_path}/_conflicted.md"
    if os.path.exists(conflict_file):
        os.remove(conflict_file)
    return {"status": "ok"}

@app.get("/api/search")
def search_pages(q: str = ""):
    # 全角スペースも半角スペースに変換して分割し、空文字を除外
    keywords = [kw.lower() for kw in q.replace("　", " ").split() if kw]
    
    if not keywords:
        return []
        
    results = []
    
    # Wikiデータディレクトリを再帰的に探索
    for root, dirs, files in os.walk(BASE_DIR):
        if ".system" in root or "assets" in root:
            continue
            
        for file in files:
            if file == "index.md":
                filepath = os.path.join(root, file)
                rel_dir = os.path.relpath(root, BASE_DIR)
                if rel_dir == ".":
                    continue
                
                # Windows対策のスラッシュ置換
                page_path = rel_dir.replace("\\", "/")
                
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                page_path_lower = page_path.lower()
                content_lower = content.lower()
                
                # ★変更: AND検索ロジック (すべてのキーワードが path か content のどちらかに含まれるか)
                is_match = True
                for kw in keywords:
                    if kw not in page_path_lower and kw not in content_lower:
                        is_match = False
                        break
                
                if is_match:
                    snippet = "パス名にのみマッチ"
                    # スニペットは、本文中で最初にヒットしたキーワードの周辺を切り出す
                    for kw in keywords:
                        if kw in content_lower:
                            idx = content_lower.find(kw)
                            start = max(0, idx - 20)
                            end = min(len(content), idx + 60)
                            snippet = content[start:end].replace("\n", " ")
                            if start > 0: snippet = "..." + snippet
                            if end < len(content): snippet = snippet + "..."
                            break # スニペット用のキーワードは1つ見つかればOK
                            
                    results.append({
                        "path": page_path,
                        "snippet": snippet
                    })
    return results

# ==========================================
# 2. ユーザー機能 API
# ==========================================
class PageRequest(BaseModel):
    page_path: str

class UserCreateRequest(BaseModel):
    username: str
    password: str

@app.post("/api/users")
def create_user(req: UserCreateRequest, current_user: str = Depends(get_current_username)):
    lock_file = f"{SYSTEM_DIR}/users.json.lock"
    with FileLock(lock_file, timeout=5):
        with open(users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        if req.username in users:
            raise HTTPException(status_code=400, detail="User already exists")
        users[req.username] = {"password": req.password, "display_name": req.username}
        with open(users_file, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
    return {"status": "ok", "message": f"User {req.username} created"}

@app.get("/api/user/me")
def get_my_profile(username: str = Depends(get_current_username)):
    data = get_user_data(username)
    edit_history = []
    log_file = f"{SYSTEM_DIR}/changes.log"
    if os.path.exists(log_file):
        with open(log_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
            # ★変更: 「自分の履歴だけ」というフィルターを外し、最新10件を無条件で取得する
            edit_history = [line.strip() for line in reversed(lines)][:15]  # ついでに取得件数を15件に増やしました
            
    return {
        "username": username, 
        "bookmarks": data["bookmarks"], 
        "view_history": data["view_history"], 
        "edit_history": edit_history
    }

@app.post("/api/user/view")
def record_view(req: PageRequest, username: str = Depends(get_current_username)):
    data = get_user_data(username)
    if req.page_path in data["view_history"]:
        data["view_history"].remove(req.page_path)
    data["view_history"].insert(0, req.page_path)
    data["view_history"] = data["view_history"][:20]
    save_user_data(username, data)
    return {"status": "ok"}

@app.post("/api/user/bookmark")
def toggle_bookmark(req: PageRequest, username: str = Depends(get_current_username)):
    data = get_user_data(username)
    if req.page_path in data["bookmarks"]:
        data["bookmarks"].remove(req.page_path)
    else:
        data["bookmarks"].append(req.page_path)
    save_user_data(username, data)
    return {"status": "ok"}

# ==========================================
# 3. アセット配信 & SPA ルーティング (一番最後に書く)
# ==========================================
@app.get("/assets/{file_path:path}")
def get_asset(file_path: str, username: str = Depends(get_current_username)):
    # ★ 1. まずシステム静的ファイル(static)を探す
    static_path = f"static/{file_path}"
    if os.path.exists(static_path):
        return FileResponse(static_path)

    # ★ 2. なければWikiデータ内の個別アセットを探す（従来通り）
    data_path = f"{BASE_DIR}/{file_path}"
    if data_path.endswith(".md"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if os.path.exists(data_path):
        return FileResponse(data_path)
        
    raise HTTPException(status_code=404, detail="Asset not found")

@app.get("/{full_path:path}", response_class=HTMLResponse)
def serve_spa(full_path: str, username: str = Depends(get_current_username)):
    # ★ index.html の参照先を static ディレクトリに変更
    index_path = "static/index.html"
    if not os.path.exists(index_path):
        return HTMLResponse("<h1>Error: static/index.html not found</h1>", status_code=404)
    with open(index_path, encoding="utf-8") as f:
        return HTMLResponse(content=f.read())