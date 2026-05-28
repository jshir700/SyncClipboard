// SyncClipboard History Browser for Android (AutoX.js)
// Run this script to view and search clipboard history.
// Requires SyncAutoxJs.js running in background to populate the database.

var dbPath = new java.io.File(context.getFilesDir(), "syncclipboard_history.db").getAbsolutePath();
var db = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(dbPath, null);
db.execSQL("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, type TEXT DEFAULT 'Text', time INTEGER NOT NULL, encrypted INTEGER DEFAULT 0)");

var MAX_HISTORY = 100;
var PAGE_SIZE = 30;
var currentOffset = 0;
var allItems = [];
var searchKeyword = "";

function loadHistory(keyword, reset) {
    if (reset) {
        currentOffset = 0;
        allItems = [];
    }
    var results;
    if (keyword) {
        var c = db.rawQuery(
            "SELECT id, text, type, time, encrypted FROM history WHERE text LIKE ? ORDER BY time DESC LIMIT ? OFFSET ?",
            ["%" + keyword + "%", String(PAGE_SIZE), String(currentOffset)]
        );
    } else {
        var c = db.rawQuery(
            "SELECT id, text, type, time FROM history ORDER BY time DESC LIMIT ? OFFSET ?",
            [String(PAGE_SIZE), String(currentOffset)]
        );
    }
    while (c.moveToNext()) {
        allItems.push({
            id: c.getInt(0),
            text: String(c.getString(1)),
            type: String(c.getString(2)),
            time: c.getLong(3)
        });
    }
    c.close();
    return allItems;
}

function formatTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    if (d.toDateString() === now.toDateString()) {
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function truncateText(text, maxLen) {
    maxLen = maxLen || 60;
    var t = text.replace(/\n/g, ' ');
    return t.length > maxLen ? t.substring(0, maxLen) + '...' : t;
}

// Build and show the UI
var w = floaty.rawWindow(
    <frame gravity="center">
        <vertical bg="#ffffff" w="*" h="*" padding="12">
            <horizontal padding="8" bg="#f5f5f5">
                <text text="Clipboard History" textSize="18sp" textColor="#333333" layout_weight="1" />
                <text id="countLabel" text="" textSize="12sp" textColor="#999999" gravity="center_vertical" />
                <button id="closeBtn" text="✕" textSize="16sp" w="36" h="36" bg="#00000000" textColor="#666666" />
            </horizontal>
            <input id="searchInput" hint="Search history..." textSize="14sp" h="44" margin="4" />
            <list id="historyList" layout_weight="1" margin="0">
                <horizontal padding="12" bg="#ffffff" minHeight="56" gravity="center_vertical">
                    <vertical layout_weight="1">
                        <text id="itemText" text="" textSize="14sp" textColor="#333333" maxLines="2" ellipsize="end" />
                        <text id="itemTime" text="" textSize="11sp" textColor="#aaaaaa" />
                    </vertical>
                    <button id="copyBtn" text="Copy" textSize="12sp" padding="8,4" bg="#e0e0e0" textColor="#555555" />
                </horizontal>
            </list>
            <horizontal padding="8" gravity="center">
                <button id="loadMoreBtn" text="Load more..." textSize="14sp" padding="12,8" bg="#e8e8e8" />
            </horizontal>
        </vertical>
    </frame>
);

// Set window position
w.setPosition(50, 100);
w.setSize(360, device.height * 0.7);

var uiThread = function(fn) {
    ui.run(fn);
};

// DataSource for the list
function refreshList() {
    var items = loadHistory(searchKeyword, true);
    var adapter = new android.widget.ArrayAdapter(context, android.R.layout.simple_list_item_1, []);
    // Manual list population via the data
    uiThread(function() {
        var listView = w.historyList;
        var data = [];
        for (var i = 0; i < items.length; i++) {
            data.push({
                time: formatTime(items[i].time),
                text: truncateText(items[i].text),
                fullText: items[i].text,
                id: items[i].id
            });
        }
        // Use a simple adapter
        var texts = data.map(function(d) { return d.time + "  " + d.text; });
        var arrayAdapter = new android.widget.ArrayAdapter(
            context, android.R.layout.simple_list_item_2, android.R.id.text1, texts
        );
        listView.setAdapter(arrayAdapter);

        // Store full text data using tags
        listView.setTag(data);

        var totalCount = loadCount();
        w.countLabel.setText("(" + totalCount + " records)");
    });
}

function loadCount() {
    var c = db.rawQuery("SELECT COUNT(*) FROM history", null);
    c.moveToFirst();
    var count = c.getInt(0);
    c.close();
    return count;
}

// Initial load
refreshList();

// Click to copy
w.historyList.setOnItemClickListener(new android.widget.AdapterView.OnItemClickListener({
    onItemClick: function(parent, view, position, id) {
        var data = parent.getTag();
        if (data && data[position]) {
            var text = data[position].fullText;
            setClip(text);
            toast("Copied to clipboard");
        }
    }
}));

// Long press to delete
w.historyList.setOnItemLongClickListener(new android.widget.AdapterView.OnItemLongClickListener({
    onItemLongClick: function(parent, view, position, id) {
        var data = parent.getTag();
        if (data && data[position]) {
            var itemId = data[position].id;
            dialogs.confirm("Delete", "Delete this history entry?", function(confirmed) {
                if (confirmed) {
                    db.delete("history", "id = ?", [String(itemId)]);
                    refreshList();
                }
            });
        }
        return true;
    }
}));

// Search on text change
w.searchInput.addTextChangedListener(new android.text.TextWatcher({
    afterTextChanged: function(s) {
        searchKeyword = String(s);
        refreshList();
    },
    beforeTextChanged: function() {},
    onTextChanged: function() {}
}));

// Load more
w.loadMoreBtn.click(function() {
    currentOffset += PAGE_SIZE;
    refreshList();
});

// Close
w.closeBtn.click(function() {
    w.close();
    db.close();
});

// Touch to dismiss
w.dismissView.setOnClickListener(function() {
    w.close();
    db.close();
});

// Keep script alive
setInterval(function() {}, 3000);