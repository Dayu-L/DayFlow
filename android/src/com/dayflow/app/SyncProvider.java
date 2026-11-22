package com.dayflow.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * 只读的同步出口：日知通过 content://com.dayflow.app.sync/sync.json 拿到时序的导出 JSON。
 * 需要 com.dayflow.app.permission.SYNC 权限。
 */
public class SyncProvider extends ContentProvider {

    static final String AUTHORITY = "com.dayflow.app.sync";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        MatrixCursor c = new MatrixCursor(new String[]{"updated", "size"});
        File f = SyncStore.file(getContext());
        c.addRow(new Object[]{SyncStore.updated(getContext()), f.exists() ? f.length() : 0});
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return "application/json";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File f = SyncStore.file(getContext());
        if (!f.exists()) throw new java.io.FileNotFoundException("还没有同步数据");
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    /** 日知 -> 时序：把增量塞进收件箱，下次时序加载时合并。 */
    @Override
    public android.os.Bundle call(String method, String arg, android.os.Bundle extras) {
        android.os.Bundle out = new android.os.Bundle();
        if ("import".equals(method)) {
            String json = extras == null ? null : extras.getString("json");
            if (json == null) json = arg;
            SyncStore.writeInbox(getContext(), json);
            out.putBoolean("ok", true);
            return out;
        }
        out.putBoolean("ok", false);
        return out;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
