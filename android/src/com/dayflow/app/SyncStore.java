package com.dayflow.app;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;

/** 把一份导出 JSON 落到应用私有目录，给 SyncProvider 读给别的 App（日知）。 */
final class SyncStore {

    private SyncStore() {}

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "sync");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File file(Context c) {
        return new File(dir(c), "dayflow.json");
    }

    static long updated(Context c) {
        File f = file(c);
        return f.exists() ? f.lastModified() : 0;
    }

    static File inbox(Context c) {
        return new File(dir(c), "inbox.json");
    }

    /** 日知推进来的增量，等下次时序加载时合并。 */
    static void writeInbox(Context c, String json) {
        if (json == null || json.length() < 2) return;
        try {
            java.io.FileOutputStream fo = new java.io.FileOutputStream(inbox(c));
            fo.write(json.getBytes("UTF-8"));
            fo.close();
        } catch (Throwable ignored) {
        }
    }

    static String takeInbox(Context c) {
        File f = inbox(c);
        if (!f.exists()) return "";
        try {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            f.delete();
            return new String(bo.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    static void write(Context c, String json) {
        if (json == null || json.length() < 2) return;
        File tmp = new File(dir(c), "dayflow.json.tmp");
        try {
            FileOutputStream fo = new FileOutputStream(tmp);
            fo.write(json.getBytes("UTF-8"));
            fo.close();
            File dst = file(c);
            if (dst.exists()) dst.delete();
            tmp.renameTo(dst);
        } catch (Throwable ignored) {
        }
    }
}
