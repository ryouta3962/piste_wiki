// --- グローバル変数 ---
let easyMDE;
let currentPath = "";
let currentBaseText = "";
let isEditing = false;
let currentBookmarks = [];
let lastServerText = "";

// --- 初期化処理 ---
window.addEventListener('DOMContentLoaded', () => {
    easyMDE = new EasyMDE({
        element: document.getElementById('editor'),
        spellChecker: false,
        sideBySideFullscreen: false, // 全画面化せずにコンテナ内で分割する
        status: ["autosave", "lines", "words", "cursor"],
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "table", "|", "preview", "side-by-side", "fullscreen", "|", "guide"]
    });

    document.getElementById('save-btn').addEventListener('click', savePage);
    document.getElementById('bookmark-btn').addEventListener('click', toggleBookmark);
    document.getElementById('clear-conflict-btn').addEventListener('click', clearConflict);
    document.getElementById('edit-btn').addEventListener('click', () => setMode('edit'));
    document.getElementById('cancel-btn').addEventListener('click', () => {
        if (confirm("編集内容を破棄して閲覧モードに戻りますか？")) setMode('view');
    });
    // ★変更: 「./」を使った相対パスでのページ作成機能
    document.getElementById('new-page-btn').addEventListener('click', () => {
        // 現在の場所をプロンプト文に表示してあげる
        const newPathInput = prompt(
            `新しいページのパスを入力してください\n` +
            `📍 現在地: /${currentPath}\n\n` +
            `※「./名前」と入力すると、現在のページのサブページとして作成されます。`
        );

        if (!newPathInput) return;

        let finalPath = newPathInput;

        // 入力が「./」から始まる場合の処理
        if (newPathInput.startsWith('./')) {
            // 現在地がフロントページ(index)の場合は、ルート直下に作る
            if (currentPath === 'index' || currentPath === '') {
                finalPath = newPathInput.substring(2);
            } else {
                // それ以外は、現在のパスにスラッシュを挟んで結合する
                finalPath = `${currentPath}/${newPathInput.substring(2)}`;
            }
        }

        // 念のため、先頭のスラッシュや連続するスラッシュを綺麗に掃除する
        finalPath = finalPath.replace(/\/+/g, '/').replace(/^\//, '');

        navigateTo(finalPath);
    });
    document.getElementById('add-user-btn').addEventListener('click', addUser);

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm("ログアウトして別のユーザーでログインし直しますか？")) {
                // バックグラウンドでデタラメな認証を投げてブラウザのキャッシュを破壊
                const xhr = new XMLHttpRequest();
                xhr.open("GET", "/api/user/me", true, "logout", "logout");
                xhr.send();
                
                xhr.onreadystatechange = function() {
                    if (xhr.readyState == 4) {
                        // アドレスバーを汚さずにトップページへリロード
                        window.location.href = "/"; 
                    }
                };
            }
        });
    }

    document.body.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a && a.getAttribute('href') && a.getAttribute('href').startsWith('/')) {
            e.preventDefault();
            navigateTo(a.getAttribute('href').substring(1));
            // ページ遷移したら検索結果を閉じて入力欄をクリアする
            const searchResults = document.getElementById('search-results');
            if (searchResults) searchResults.style.display = 'none';
            document.getElementById('search-input').value = "";
        }
    });

    window.addEventListener('popstate', () => {
        navigateTo(window.location.pathname.substring(1) || 'index', false);
    });

    const initialPath = window.location.pathname.substring(1) || 'index';
    navigateTo(initialPath);
    // --- コンフリクト解消ウィンドウの表示 ---
    document.getElementById('show-diff-btn').addEventListener('click', () => {
        const myText = easyMDE.value();

        // 1. 差分の計算と描画（左側）
        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(lastServerText, myText);
        dmp.diff_cleanupSemantic(diffs);

        let html = "";
        for (let i = 0; i < diffs.length; i++) {
            const op = diffs[i][0];
            const text = diffs[i][1].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            if (op === 1) html += `<ins>${text}</ins>`;
            else if (op === -1) html += `<del>${text}</del>`;
            else html += `<span>${text}</span>`;
        }
        document.getElementById('diff-viewer').innerHTML = html;

        // 2. 解消用エディタ（右側）に自分のテキストをセット
        document.getElementById('conflict-resolver-editor').value = myText;

        // モーダル表示
        document.getElementById('diff-modal-overlay').style.display = 'block';
        document.getElementById('diff-modal').style.display = 'flex';
    });

    // モーダルを閉じる
    document.getElementById('close-diff-btn').addEventListener('click', () => {
        document.getElementById('diff-modal-overlay').style.display = 'none';
        document.getElementById('diff-modal').style.display = 'none';
    });

    // --- ★追加: 強制上書き保存（競合解消） ---
    document.getElementById('force-save-btn').addEventListener('click', async () => {
        const btn = document.getElementById('force-save-btn');
        const resolvedText = document.getElementById('conflict-resolver-editor').value;

        btn.innerText = "⏳ 保存中...";
        btn.disabled = true;

        try {
            const res = await fetch(`/api/save/${currentPath}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    base_text: currentBaseText,
                    new_text: resolvedText,
                    force: true // ★ここで強制保存フラグを立てる
                })
            });
            const result = await res.json();

            if (result.status === "success") {
                // 保存成功時の処理
                currentBaseText = resolvedText;
                easyMDE.value(resolvedText); // メインエディタも更新
                renderViewer(resolvedText);

                document.getElementById('conflict-alert').style.display = 'none';
                document.getElementById('diff-modal-overlay').style.display = 'none';
                document.getElementById('diff-modal').style.display = 'none';

                refreshSidebar();
                setMode('view');
                alert("✅ 競合を解消して保存しました！");
            } else {
                alert("保存に失敗しました。");
            }
        } catch (err) {
            alert("通信エラーが発生しました。");
        } finally {
            btn.innerText = "✅ この内容で競合を解消して保存";
            btn.disabled = false;
        }
    });
    // --- ★追加: 検索機能 (リアルタイムサジェスト) ---
    let searchTimeout;
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    if (searchInput) {
        // 文字入力のたびにAPIを叩く（ただし300ms待ってから叩くことでサーバー負荷を減らす：デバウンス処理）
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const q = e.target.value.trim();

            if (!q) {
                searchResults.style.display = 'none';
                return;
            }

            searchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                    if (!res.ok) return;
                    const data = await res.json();

                    if (data.length === 0) {
                        searchResults.innerHTML = '<div style="padding: 10px; color: #666; font-size: 0.9em;">見つかりませんでした</div>';
                    } else {
                        // XSS対策関数
                        const escapeHtml = (str) => str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));

                        // ★変更: 複数キーワードの抽出と、全キーワードをハイライトするための正規表現 (OR結合)
                        // 全角スペースも考慮して分割
                        const keywords = q.replace(/　/g, ' ').split(/\s+/).filter(k => k);
                        const escapedKeywords = keywords.map(kw => escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');

                        searchResults.innerHTML = data.map(item => {
                            // マッチしたすべての文字列を <mark> タグで囲む
                            const safePath = escapeHtml(item.path).replace(regex, '<mark>$1</mark>');
                            const safeSnippet = escapeHtml(item.snippet).replace(regex, '<mark>$1</mark>');
                            return `<a href="/${item.path}" class="search-result-item">
                                        <div class="search-path">📄 ${safePath}</div>
                                        <div class="search-snippet">${safeSnippet}</div>
                                    </a>`;
                        }).join('');
                    }
                    searchResults.style.display = 'block';
                } catch (err) {
                    console.error("検索エラー", err);
                }
            }, 300);
        });

        // 検索枠の外側をクリックしたらサジェストを閉じる
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#search-box-container')) {
                searchResults.style.display = 'none';
            }
        });

        // 検索枠にフォーカスが戻ったら再表示する
        searchInput.addEventListener('focus', (e) => {
            if (e.target.value.trim() && searchResults.innerHTML) {
                searchResults.style.display = 'block';
            }
        });
    }
});

// --- 閲覧/編集モード切替 ---
function setMode(mode) {
    isEditing = (mode === 'edit');
    if (isEditing) {
        document.getElementById('viewer').style.display = 'none';
        document.getElementById('editor-container').style.display = 'block';
        document.getElementById('edit-btn').style.display = 'none';
        document.getElementById('save-btn').style.display = 'inline-block';
        document.getElementById('cancel-btn').style.display = 'inline-block';
        easyMDE.value(currentBaseText);

        // ★変更: 編集モードに入った時、デフォルトで「2画面プレビュー」をオンにする
        setTimeout(() => {
            easyMDE.codemirror.refresh();
            if (!easyMDE.isSideBySideActive()) {
                easyMDE.toggleSideBySide();
            }
        }, 10);
    } else {
        document.getElementById('viewer').style.display = 'block';
        document.getElementById('editor-container').style.display = 'none';
        document.getElementById('edit-btn').style.display = 'inline-block';
        document.getElementById('save-btn').style.display = 'none';
        document.getElementById('cancel-btn').style.display = 'none';

        // ★変更: 閲覧モードに戻る時は2画面を解除しておく
        if (easyMDE && easyMDE.isSideBySideActive()) {
            easyMDE.toggleSideBySide();
        }
    }
}

// --- Markdownレンダリング ---
function renderViewer(mdText) {
    if (!mdText) mdText = "";
    const rawHtml = marked.parse(mdText);
    document.getElementById('viewer').innerHTML = DOMPurify.sanitize(rawHtml);
}

// --- SPAルーティング ---
async function navigateTo(path, pushHistory = true) {
    if (!path) path = 'index';
    currentPath = path;
    if (pushHistory) window.history.pushState({}, "", `/${path}`);

    // ★変更: ページ名を「クリック可能なパンくずリスト」に変換
    const segments = path.split('/');
    let buildPath = "";
    const breadcrumbHtml = segments.map((seg, i) => {
        buildPath += (i === 0 ? "" : "/") + seg;
        return `<a href="/${buildPath}">${seg}</a>`;
    }).join('<span style="color: #a1b0c6; margin: 0 8px; font-size: 0.8em;">/</span>');
    document.getElementById('page-title').innerHTML = `📄 ${breadcrumbHtml}`;

    document.getElementById('conflict-alert').style.display = 'none';

    try {
        const res = await fetch(`/api/pages/${path}`);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);

        const data = await res.json();
        currentBaseText = data.content || "";
        renderViewer(currentBaseText);
        setMode(currentBaseText ? 'view' : 'edit');

        if (data.has_conflict) document.getElementById('conflict-alert').style.display = 'block';

        await fetch('/api/user/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_path: path })
        });

        refreshSidebar();
        loadPageAssets(path);

    } catch (err) {
        console.error("ページの読み込みに失敗しました", err);
        renderViewer("## ⚠️ 読み込みエラー\n通信に失敗しました。");
    }
}

// --- 保存処理 ---
async function savePage() {
    const btn = document.getElementById('save-btn');
    btn.innerText = "⏳ 保存中...";
    btn.disabled = true;

    try {
        const res = await fetch(`/api/save/${currentPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_text: currentBaseText, new_text: easyMDE.value() })
        });
        const result = await res.json();

        if (result.status === "success") {
            currentBaseText = easyMDE.value();
            renderViewer(currentBaseText);
            btn.innerText = "✅ 保存完了";
            refreshSidebar();
            setTimeout(() => { btn.innerText = "💾 保存"; btn.disabled = false; setMode('view'); }, 1000);
        } else {
            lastServerText = result.server_text || "";
            document.getElementById('conflict-alert').style.display = 'block';
            btn.innerText = "💾 保存";
            btn.disabled = false;
        }
    } catch (err) {
        alert("保存に失敗しました。");
        btn.innerText = "💾 保存";
        btn.disabled = false;
    }
}

// --- その他機能 ---
async function addUser() {
    const username = prompt("新しいユーザー名:");
    if (!username) return;
    const password = prompt("パスワード:");
    if (!password) return;
    try {
        const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        alert(res.ok ? "✅ 作成しました！" : "❌ 作成失敗");
    } catch (err) { alert("通信エラー"); }
}

async function clearConflict() {
    await fetch(`/api/conflicts/${currentPath}`, { method: 'DELETE' });
    document.getElementById('conflict-alert').style.display = 'none';
}

async function refreshSidebar() {
    try {
        // 1. ユーザー固有情報（ブックマーク・履歴など）の取得
        const res = await fetch('/api/user/me');
        if (!res.ok) return;
        const userData = await res.json();

        currentBookmarks = userData.bookmarks;
        updateBookmarkBtn();

        document.getElementById('current-user').innerText = userData.username;
        const makeList = (items) => items.map(item => `<li><a href="/${item}">${item}</a></li>`).join('');
        document.getElementById('bookmark-list').innerHTML = makeList(userData.bookmarks);
        document.getElementById('view-history-list').innerHTML = makeList(userData.view_history);

        document.getElementById('edit-history-list').innerHTML = userData.edit_history.map(log => {
            const parts = log.split('\t');
            if (parts.length >= 3) {
                const time = parts[0].substring(5, 16);
                const author = parts[1];
                const file = parts[2].replace(/\.md$/, '');
                return `<li><span style="font-size:0.8em; color:#7a869a;">${time} by <b>${author}</b></span> <br> <a href="/${file}">${file}</a></li>`;
            }
            return '';
        }).join('');

        // ★追加: 2. カスタムサイドバー (sidebar/index.md) の取得と描画
        try {
            const sidebarRes = await fetch('/api/pages/sidebar');
            if (sidebarRes.ok) {
                const sidebarData = await sidebarRes.json();
                if (sidebarData.content) {
                    // marked.jsでHTML化し、XSS対策して流し込む
                    const html = marked.parse(sidebarData.content);
                    document.getElementById('custom-sidebar-content').innerHTML = DOMPurify.sanitize(html);
                }
            }
        } catch (e) {
            console.warn("カスタムサイドバーが見つかりません。");
        }

    } catch (err) { console.error("サイドバーエラー", err); }
}

// ★追加: お気に入りボタンのUI更新ヘルパー
function updateBookmarkBtn() {
    const btn = document.getElementById('bookmark-btn');
    if (currentBookmarks.includes(currentPath)) {
        btn.innerText = "⭐ 登録済み";
        btn.classList.remove('secondary'); // アクセントカラー（青）にする
    } else {
        btn.innerText = "☆ ブックマーク";
        btn.classList.add('secondary');   // グレーにする
    }
}

async function toggleBookmark() {
    await fetch('/api/user/bookmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_path: currentPath }) });
    refreshSidebar(); // ここでデータを再取得し、自動で updateBookmarkBtn() も呼ばれる
}

function loadPageAssets(path) {
    document.querySelectorAll('.page-specific-asset').forEach(el => el.remove());
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = `/assets/${path}/index.css`; link.className = 'page-specific-asset';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = `/assets/${path}/index.js`; script.className = 'page-specific-asset';
    script.onerror = () => script.remove();
    document.body.appendChild(script);
}