console.clear()
const user = ""
const token = ""
const authHeader = "basic " + $text.base64Encode(`${user}:${token}`)
const path = ""

// End-to-End Encryption (set the SAME password as your desktop client)
// Leave empty to disable encryption
const encryptionPassword = ""

let httpPara = {
    url: `https://${path}/SyncClipboard.json`,
    header: { authorization: authHeader }
}

// ====== E2E Encryption Helpers ======

const SALT_PREFIX = "SyncClipboardE2EE:v1:salt:";
const VERIFY_PREFIX = "SyncClipboardE2EE:v1:verify:";
const MAX_HISTORY = 100;

let derivedKey = null;
let encryptionEnabled = false;
let db = null;

async function initEncryption() {
    if (!encryptionPassword || encryptionPassword.length === 0) return;
    try {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            console.warn("Web Crypto API not available on this iOS version");
            return;
        }
        var enc = new TextEncoder();
        var saltHash = await crypto.subtle.digest("SHA-256", enc.encode(SALT_PREFIX + encryptionPassword));
        var salt = new Uint8Array(saltHash).slice(0, 16);
        var verifyHash = await crypto.subtle.digest("SHA-256", enc.encode(VERIFY_PREFIX + encryptionPassword));
        var verifyHex = Array.from(new Uint8Array(verifyHash)).map(b => b.toString(16).padStart(2, "0")).join("");
        var storedHash = getStoredVerificationHash();
        if (storedHash) {
            if (verifyHex !== storedHash) { console.error("Encryption password incorrect"); return; }
        } else { setStoredVerificationHash(verifyHex); }
        var keyMaterial = await crypto.subtle.importKey("raw", enc.encode(encryptionPassword), "PBKDF2", false, ["deriveKey"]);
        derivedKey = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 600000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
        );
        encryptionEnabled = true;
    } catch (e) { console.error("Encryption init failed: " + e); }
}

async function encryptText(plaintext) {
    if (!encryptionEnabled || !derivedKey) return plaintext;
    try {
        var enc = new TextEncoder();
        var nonce = crypto.getRandomValues(new Uint8Array(12));
        var ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, derivedKey, enc.encode(plaintext));
        var result = new Uint8Array(1 + 12 + ciphertext.byteLength);
        result[0] = 1; result.set(nonce, 1); result.set(new Uint8Array(ciphertext), 13);
        return btoa(String.fromCharCode(...result));
    } catch (e) { return plaintext; }
}

async function decryptText(base64Cipher) {
    if (!encryptionEnabled || !derivedKey) return base64Cipher;
    try {
        var binary = atob(base64Cipher);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        if (bytes.length < 29) return base64Cipher;
        var nonce = bytes.slice(1, 13);
        var plainBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, derivedKey, bytes.slice(13));
        return new TextDecoder().decode(plainBytes);
    } catch (e) { return "[Decryption failed]"; }
}

function getStoredVerificationHash() {
    try { return Keychain.get("syncclipboard_crypto"); } catch (e) { return null; }
}

function setStoredVerificationHash(value) {
    try { Keychain.set("syncclipboard_crypto", value); } catch (e) {}
}

// ====== Local History ======

function initHistoryDb() {
    try {
        db = Database.open("syncclipboard_history.db");
        db.update("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, type TEXT, time REAL, encrypted INTEGER)");
    } catch(e) { console.error("History DB init failed: " + e); }
}

function saveToHistory(text, encrypted) {
    if (!db || !text) return;
    try {
        var stmt = db.update({
            sql: "INSERT INTO history (text, type, time, encrypted) VALUES (?, 'Text', ?, ?)",
            args: [text, Date.now(), encrypted ? 1 : 0]
        });
        var total = loadHistoryCount();
        if (total > MAX_HISTORY) {
            db.update("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY time DESC LIMIT " + MAX_HISTORY + ")");
        }
    } catch(e) {}
}

function loadHistoryCount() {
    if (!db) return 0;
    try { return db.query("SELECT COUNT(*) as c FROM history").values[0].c; } catch(e) { return 0; }
}

function loadHistory(keyword) {
    if (!db) return [];
    try {
        var sql = keyword
            ? "SELECT id, text, time FROM history WHERE text LIKE ? ORDER BY time DESC LIMIT 100"
            : "SELECT id, text, time FROM history ORDER BY time DESC LIMIT 100";
        var args = keyword ? ["%" + keyword + "%"] : [];
        return db.query({ sql: sql, args: args }).values;
    } catch(e) { return []; }
}

function deleteHistoryItem(id) {
    if (!db) return;
    try { db.update({ sql: "DELETE FROM history WHERE id = ?", args: [id] }); } catch(e) {}
}

// ====== UI ======

let currentTab = "sync";
let historyData = [];

function formatTime(ts) {
    var d = new Date(ts); var n = new Date();
    var pad = function(x) { return x < 10 ? '0' + x : '' + x; };
    if (d.toDateString() === n.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function refreshHistoryList(keyword) {
    historyData = loadHistory(keyword);
    var table = $("historyTable");
    if (!table) return;

    var rows = [];
    for (var i = 0; i < historyData.length; i++) {
        var item = historyData[i];
        var t = item.text || "";
        var display = t.replace(/\n/g, ' ').substring(0, 60);
        if (t.length > 60) display += "...";
        rows.push({
            type: "view",
            props: { id: "hrow_" + i },
            layout: function(make, view) { make.left.right.inset(0); make.height.equalTo(44); },
            views: [
                { type: "label", props: { text: display, lines: 1, font: $font(14), textColor: $color("#333") },
                  layout: function(make, view) { make.left.inset(12); make.top.inset(4); make.right.inset(60); } },
                { type: "label", props: { text: formatTime(item.time), font: $font(11), textColor: $color("#aaa") },
                  layout: function(make, view) { make.left.inset(12); make.top.equalTo(22); } }
            ],
            events: {
                tapped: function() { $keyboard.insert(t); },
                ready: function(view) {
                    view.addGestureRecognizer($gestureRecognizer({
                        type: "swipe", direction: 1, // left
                        events: {
                            ended: function(sender, location, state) {
                                deleteHistoryItem(item.id);
                                refreshHistoryList();
                            }
                        }
                    }));
                }
            }
        });
    }

    table.views = rows;
    $("historyCount").text = "(" + loadHistoryCount() + " records)";
}

$ui.render({
    props: { bgcolor: $color("white"), title: "SyncClipboard" },
    views: [
        // Tab bar
        { type: "view", props: { id: "tabBar" },
          layout: function(make) { make.top.left.right.inset(0); make.height.equalTo(40); },
          views: [
              { type: "button", props: { id: "syncTab", title: "Sync", bgcolor: $color("#007AFF"), titleColor: $color("white"), font: $font("bold", 14) },
                layout: function(make) { make.left.inset(0); make.top.bottom.inset(0); make.width.equalTo(make.super.width).multipliedBy(0.5); },
                events: { tapped: function() { switchTab("sync"); } } },
              { type: "button", props: { id: "historyTab", title: "History", bgcolor: $color("#E5E5EA"), titleColor: $color("#007AFF"), font: $font(14) },
                layout: function(make) { make.right.inset(0); make.top.bottom.inset(0); make.width.equalTo(make.super.width).multipliedBy(0.5); },
                events: { tapped: function() { switchTab("history"); } } }
          ]
        },
        // === Sync Panel ===
        { type: "view", props: { id: "syncPanel" },
          layout: function(make) { make.top.equalTo($("tabBar").bottom); make.left.right.inset(0); },
          views: [
              // Remote
              { type: "view", props: { id: "view1" },
                layout: function(make) { make.top.left.right.inset(10); make.height.equalTo(22); },
                views: [
                    { type: "label", props: { id: "id远程", text: "远程: " }, layout: $align.left },
                    { type: "label", props: { id: "remote", flex: "L" }, layout: function(make, view) { make.top.equalTo($("id远程").top); make.left.equalTo($("id远程").right).offset(10); } },
                    { type: "spinner", props: { loading: false, id: "下载spinnerId" }, layout: function(make) { make.top.equalTo($("id远程").top); make.right.equalTo(0); } }
                ]
              },
              // Buttons row
              { type: "view", props: { id: "view2" },
                layout: function(make) { make.top.equalTo($("view1").bottom); make.height.equalTo(34); make.left.right.inset(10); },
                views: [
                    { type: "button", props: { title: "插入", id: "插入Id" }, layout: function(make) { make.width.equalTo(130); make.left.equalTo(0); } },
                    { type: "button", props: { title: "插入并返回", id: "插入并返回Id" }, layout: function(make) { make.left.equalTo($("插入Id").right).offset(10); make.width.equalTo(130); } },
                    { type: "button", props: { id: "freshRemoteId", icon: $icon("162") }, layout: function(make) { make.left.equalTo($("插入并返回Id").right).offset(10); make.right.equalTo(0); make.height.equalTo($("插入Id").height); } }
                ]
              },
              // Local
              { type: "view", props: { id: "view3" },
                layout: function(make) { make.top.equalTo($("view2").bottom); make.height.equalTo(22); make.left.right.inset(10); },
                views: [
                    { type: "label", props: { id: "id本地", text: "本地: " }, layout: $align.left },
                    { type: "label", props: { id: "本地labelId" }, layout: function(make) { make.top.equalTo($("id本地").top); make.left.equalTo($("id本地").right).offset(10); } },
                    { type: "spinner", props: { id: "上传本地spinnerId" }, layout: function(make) { make.top.equalTo($("id本地").top); make.right.equalTo(0); } }
                ]
              },
              // Selected
              { type: "view", props: { id: "view4" },
                layout: function(make) { make.top.equalTo($("view3").bottom); make.height.equalTo(22); make.left.right.inset(10); },
                views: [
                    { type: "label", props: { id: "id已选", text: "已选: " }, layout: $align.left },
                    { type: "label", props: { id: "已选textId" }, layout: function(make) { make.top.equalTo($("id已选").top); make.left.equalTo($("id已选").right).offset(10); } },
                    { type: "spinner", props: { id: "上传已选spinnerId" }, layout: function(make) { make.top.equalTo($("id已选").top); make.right.equalTo(0); } }
                ]
              },
              // Upload buttons
              { type: "view", props: { id: "view5" },
                layout: function(make) { make.top.equalTo($("view4").bottom); make.height.equalTo(34); make.left.right.inset(10); },
                views: [
                    { type: "button", props: { title: "上传本地", id: "上传本地Id" }, layout: function(make) { make.width.equalTo(130); make.left.equalTo(0); } },
                    { type: "button", props: { title: "上传已选", id: "已选Id" }, layout: function(make) { make.left.equalTo($("上传本地Id").right).offset(10); make.width.equalTo(130); } },
                    { type: "button", props: { id: "freshLocalId", icon: $icon("162") }, layout: function(make) { make.left.equalTo($("已选Id").right).offset(10); make.right.equalTo(0); make.height.equalTo($("已选Id").height); } }
                ]
              },
              // Progress
              { type: "progress", props: { value: 0, id: "progressId" },
                layout: function(make) { make.top.equalTo($("view5").bottom).offset(10); make.left.right.inset(10); make.height.equalTo(2); } },
              // Shortcut button
              { type: "button", props: { title: "捷径" },
                layout: function(make) { make.top.equalTo($("progressId").bottom).offset(8); make.height.equalTo(34); make.left.right.inset(10); },
                events: { tapped: function() { $app.openURL("shortcuts://run-shortcut?name=Clipboard%20EX"); } } }
          ]
        },
        // === History Panel ===
        { type: "view", props: { id: "historyPanel", hidden: true },
          layout: function(make) { make.top.equalTo($("tabBar").bottom); make.left.right.bottom.inset(0); },
          views: [
              { type: "input", props: { id: "historySearch", placeholder: "Search history..." },
                layout: function(make) { make.top.left.right.inset(8); make.height.equalTo(36); },
                events: { changed: function(sender) { refreshHistoryList(sender.text); } } },
              { type: "label", props: { id: "historyCount", text: "", font: $font(11), textColor: $color("#999"), align: $align.center },
                layout: function(make) { make.top.equalTo($("historySearch").bottom); make.height.equalTo(20); make.left.right.inset(8); } },
              { type: "scroll",
                layout: function(make) { make.top.equalTo($("historyCount").bottom).offset(4); make.left.right.bottom.inset(0); },
                views: [
                    { type: "view", props: { id: "historyTable" },
                      layout: function(make) { make.top.left.right.inset(0); make.height.equalTo(44 * historyData.length + 20); } }
                ] }
          ]
        }
    ]
});

// ====== Tab Switching ======

function switchTab(tab) {
    currentTab = tab;
    if (tab === "sync") {
        $("syncPanel").hidden = false;
        $("historyPanel").hidden = true;
        $("syncTab").bgcolor = $color("#007AFF");
        $("syncTab").titleColor = $color("white");
        $("historyTab").bgcolor = $color("#E5E5EA");
        $("historyTab").titleColor = $color("#007AFF");
    } else {
        $("syncPanel").hidden = true;
        $("historyPanel").hidden = false;
        $("syncTab").bgcolor = $color("#E5E5EA");
        $("syncTab").titleColor = $color("#007AFF");
        $("historyTab").bgcolor = $color("#007AFF");
        $("historyTab").titleColor = $color("white");
        refreshHistoryList();
    }
}

// ====== Sync Logic ======

async function download() {
    disableButton()
    $("下载spinnerId").loading = true
    httpPara.method = "GET"
    httpPara.body = null
    const resp = await $http.request(httpPara)
    var text = resp.data.text;
    if (resp.data.encrypted === true && text) {
        text = await decryptText(text);
    }
    $("remote").text = text || ""
    // Save to local history
    if (text) saveToHistory(text, resp.data.encrypted === true);
    $("下载spinnerId").loading = false
    enableButton()
}

async function upload(text, loaditem) {
    disableButton()
    loaditem.loading = true
    var payloadText = text;
    var encrypted = false;
    if (encryptionEnabled && derivedKey) {
        payloadText = await encryptText(text);
        encrypted = true;
    }
    httpPara.body = { "text": payloadText, "type": "Text", "hasData": false, "encrypted": encrypted }
    httpPara.method = "PUT"
    await $http.request(httpPara)
    // Save to local history
    if (text) saveToHistory(text, encrypted);
    loaditem.loading = false
    await download()
    enableButton()
}

// ====== Button events ======

$("插入Id").whenTapped(() => { $keyboard.insert($("remote").text); });
$("插入并返回Id").whenTapped(() => { $keyboard.insert($("remote").text); $keyboard.next(); });
$("freshRemoteId").whenTapped(() => { download(); });
$("freshLocalId").whenTapped(() => {
    $("已选textId").text = $keyboard.selectedText || "";
    $("本地labelId").text = $clipboard.text || "";
});
$("上传本地Id").whenTapped(() => { upload($("本地labelId").text, $("上传本地spinnerId")); });
$("已选Id").whenTapped(() => { upload($("已选textId").text, $("上传已选spinnerId")); });
$("已选Id").addEventHandler({
    events: $UIEvent.allEvents,
    handler: () => {
        $("已选textId").text = $keyboard.selectedText || "";
        $("本地labelId").text = $clipboard.text || "";
    }
});

const buttons = [$("freshRemoteId"), $("上传本地Id"), $("已选Id")];

function disableButton() {
    buttons.forEach(b => { b.userInteractionEnabled = false; b.bgcolor = $color("#7f7f7f"); });
}

function enableButton() {
    buttons.forEach(b => { b.userInteractionEnabled = true; b.bgcolor = $("插入Id").bgcolor; });
}

// ====== Init ======

async function init() {
    initHistoryDb();
    await initEncryption();
    $("已选textId").text = $keyboard.selectedText || "";
    $("本地labelId").text = $clipboard.text || "";
    await download();
}
init();
