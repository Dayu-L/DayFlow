package com.dayflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** 桌面小组件：显示今天剩余的日程、下一项和 DDL / 任务数量。 */
public class DayFlowWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "dayflow_widget";
    static final String KEY_SNAPSHOT = "snapshot";
    static final String KEY_PAGE_PREFIX = "page_";
    static final String ACTION_REFRESH = "com.dayflow.app.WIDGET_REFRESH";
    static final String ACTION_PREV = "com.dayflow.app.WIDGET_PREV";
    static final String ACTION_NEXT = "com.dayflow.app.WIDGET_NEXT";
    static final String EXTRA_WIDGET_ID = "widgetId";

    static void saveSnapshot(Context context, String json) {
        Context ctx = context.getApplicationContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SNAPSHOT, json == null ? "" : json)
                .apply();
    }

    static boolean canPin(Context context) {
        if (Build.VERSION.SDK_INT < 26) return false;
        Context ctx = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        return manager != null && manager.isRequestPinAppWidgetSupported();
    }

    static void requestPin(Context context) {
        if (!canPin(context)) return;
        Context ctx = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        if (manager == null) return;
        ComponentName provider = new ComponentName(ctx, DayFlowWidgetProvider.class);
        manager.requestPinAppWidget(provider, null, null);
    }

    static void updateAll(Context context) {
        Context ctx = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        if (manager == null) return;
        ComponentName provider = new ComponentName(ctx, DayFlowWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int id : ids) updateWidget(ctx, manager, id);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateWidget(context.getApplicationContext(), manager, id);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        updateAll(context);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        super.onDeleted(context, appWidgetIds);
        SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        for (int id : appWidgetIds) editor.remove(KEY_PAGE_PREFIX + id);
        editor.apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PREV.equals(action) || ACTION_NEXT.equals(action)) {
            int widgetId = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
            if (widgetId >= 0) {
                Context ctx = context.getApplicationContext();
                int pages = pageCount(ctx);
                if (pages > 1) {
                    int page = getPage(ctx, widgetId);
                    int next = (page + (ACTION_NEXT.equals(action) ? 1 : -1) + pages) % pages;
                    setPage(ctx, widgetId, next);
                    AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
                    if (manager != null) updateWidget(ctx, manager, widgetId);
                }
            }
            return;
        }

        super.onReceive(context, intent);
        if (Intent.ACTION_DATE_CHANGED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || ACTION_REFRESH.equals(action)) {
            updateAll(context);
        }
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.dayflow_widget);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new Date());
        String todayLabel = new SimpleDateFormat("M月d日 EEEE", Locale.CHINA).format(new Date());

        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SNAPSHOT, "");
        JSONObject snap = null;
        try {
            if (raw != null && !raw.isEmpty()) snap = new JSONObject(raw);
        } catch (Exception ignored) {
            snap = null;
        }

        boolean dark = snap != null && snap.optBoolean("dark", false);
        int textColor = parseColor(snap == null ? "" : snap.optString("text", ""),
                dark ? 0xFFEEF1F4 : 0xFF111315);
        int mutedColor = parseColor(snap == null ? "" : snap.optString("muted", ""),
                dark ? 0xFFA4ADB8 : 0xFF5F6368);
        int accentColor = parseColor(snap == null ? "" : snap.optString("accent", ""),
                dark ? 0xFF74A9FF : 0xFF1D5FBF);

        views.setInt(R.id.widget_root, "setBackgroundResource",
                dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg_light);
        views.setOnClickPendingIntent(R.id.widget_root, openApp(context, null, widgetId));

        views.setTextViewText(R.id.widget_header_title, "今日日程");
        views.setTextViewText(R.id.widget_header_date, todayLabel);
        tint(views, R.id.widget_header_title, textColor);
        tint(views, R.id.widget_header_date, mutedColor);
        tint(views, R.id.widget_next_time, accentColor);
        tint(views, R.id.widget_next_title, textColor);
        tint(views, R.id.widget_next_meta, mutedColor);
        tint(views, R.id.widget_empty, mutedColor);
        tint(views, R.id.widget_footer, mutedColor);
        tint(views, R.id.widget_prev, mutedColor);
        tint(views, R.id.widget_page, mutedColor);
        tint(views, R.id.widget_next, mutedColor);

        boolean hasSnapshot = snap != null && today.equals(snap.optString("date", ""));
        if (!hasSnapshot) {
            views.setViewVisibility(R.id.widget_next_block, View.GONE);
            views.setViewVisibility(R.id.widget_events, View.GONE);
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            views.setViewVisibility(R.id.widget_bottom, View.GONE);
            views.setTextViewText(R.id.widget_empty, raw == null || raw.isEmpty()
                    ? "打开 DayFlow 同步今日日程"
                    : "打开 DayFlow 更新今天日程");
            manager.updateAppWidget(widgetId, views);
            return;
        }

        String dateLabel = snap.optString("dateLabel", "");
        views.setTextViewText(R.id.widget_header_date, dateLabel.isEmpty() ? todayLabel : dateLabel);

        JSONArray all = snap.optJSONArray("events");
        int now = nowMinutes();
        List<JSONObject> remaining = new ArrayList<>();
        boolean hasAnyEvent = false;
        boolean allDone = true;

        if (all != null) {
            for (int i = 0; i < all.length(); i++) {
                JSONObject event = all.optJSONObject(i);
                if (event == null) continue;
                hasAnyEvent = true;
                if (!event.optBoolean("done", false)) allDone = false;
                if (event.optBoolean("done", false)) continue;
                int end = event.optInt("end", 0);
                if (end > now) remaining.add(event);
            }
        }

        Collections.sort(remaining, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Integer.compare(a.optInt("start", 0), b.optInt("start", 0));
            }
        });

        int pages = remaining.isEmpty() ? 1 : ((remaining.size() + 2) / 3);
        int page = Math.min(getPage(context, widgetId), pages - 1);
        setPage(context, widgetId, page);

        if (remaining.isEmpty()) {
            views.setViewVisibility(R.id.widget_next_block, View.GONE);
            views.setViewVisibility(R.id.widget_events, View.GONE);
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            views.setTextViewText(R.id.widget_empty,
                    !hasAnyEvent ? "今天没有安排，打开 DayFlow 添加日程"
                            : (allDone ? "今天的日程都完成了" : "今天剩下的时间没有安排了"));
        } else {
            views.setViewVisibility(R.id.widget_empty, View.GONE);
            int start = page * 3;
            int end = Math.min(remaining.size(), start + 3);
            List<JSONObject> pageItems = remaining.subList(start, end);
            JSONObject next = pageItems.get(0);
            boolean running = next.optInt("start", 0) <= now;
            String prefix = page == 0 ? (running ? "进行中 · " : "下一项 · ") : "稍后 · ";
            views.setViewVisibility(R.id.widget_next_block, View.VISIBLE);
            views.setTextViewText(R.id.widget_next_time, prefix + next.optString("time", ""));
            views.setTextViewText(R.id.widget_next_title, next.optString("title", "未命名日程"));
            String meta = next.optString("meta", "");
            views.setTextViewText(R.id.widget_next_meta, meta);
            views.setViewVisibility(R.id.widget_next_meta, meta.isEmpty() ? View.GONE : View.VISIBLE);
            views.setOnClickPendingIntent(R.id.widget_next_block,
                    openApp(context, next.optString("id", ""), widgetId * 31 + 1));

            views.removeAllViews(R.id.widget_events);
            int rows = 0;
            for (int i = 1; i < pageItems.size() && rows < 2; i++, rows++) {
                JSONObject event = pageItems.get(i);
                RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.dayflow_widget_event);
                row.setTextViewText(R.id.widget_row_time, event.optString("time", ""));
                row.setTextViewText(R.id.widget_row_title, event.optString("title", "未命名日程"));
                tint(row, R.id.widget_row_time, accentColor);
                tint(row, R.id.widget_row_title, textColor);
                row.setOnClickPendingIntent(R.id.widget_row_root,
                        openApp(context, event.optString("id", ""), widgetId * 31 + i + 2));
                views.addView(R.id.widget_events, row);
            }
            views.setViewVisibility(R.id.widget_events, rows > 0 ? View.VISIBLE : View.GONE);
        }

        String footer = buildFooter(snap.optJSONObject("counts"));
        views.setTextViewText(R.id.widget_footer, footer);
        views.setViewVisibility(R.id.widget_footer, footer.isEmpty() ? View.GONE : View.VISIBLE);

        if (pages > 1) {
            views.setViewVisibility(R.id.widget_prev, View.VISIBLE);
            views.setViewVisibility(R.id.widget_page, View.VISIBLE);
            views.setViewVisibility(R.id.widget_next, View.VISIBLE);
            views.setTextViewText(R.id.widget_page, (page + 1) + "/" + pages);
            views.setOnClickPendingIntent(R.id.widget_prev, pageIntent(context, widgetId, ACTION_PREV));
            views.setOnClickPendingIntent(R.id.widget_next, pageIntent(context, widgetId, ACTION_NEXT));
        } else {
            views.setViewVisibility(R.id.widget_prev, View.GONE);
            views.setViewVisibility(R.id.widget_page, View.GONE);
            views.setViewVisibility(R.id.widget_next, View.GONE);
        }
        views.setViewVisibility(R.id.widget_bottom,
                (footer.isEmpty() && pages <= 1) ? View.GONE : View.VISIBLE);
        manager.updateAppWidget(widgetId, views);
    }

    private static int getPage(Context context, int widgetId) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getInt(KEY_PAGE_PREFIX + widgetId, 0);
    }

    private static void setPage(Context context, int widgetId, int page) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_PAGE_PREFIX + widgetId, Math.max(0, page))
                .apply();
    }

    private static int pageCount(Context context) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SNAPSHOT, "");
        try {
            JSONObject snap = new JSONObject(raw == null ? "" : raw);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new Date());
            if (!today.equals(snap.optString("date", ""))) return 1;
            JSONArray all = snap.optJSONArray("events");
            if (all == null) return 1;
            int now = nowMinutes();
            int count = 0;
            for (int i = 0; i < all.length(); i++) {
                JSONObject event = all.optJSONObject(i);
                if (event == null || event.optBoolean("done", false)) continue;
                if (event.optInt("end", 0) > now) count++;
            }
            return Math.max(1, (count + 2) / 3);
        } catch (Exception ignored) {
            return 1;
        }
    }

    private static PendingIntent pageIntent(Context context, int widgetId, String action) {
        Intent intent = new Intent(context, DayFlowWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(EXTRA_WIDGET_ID, widgetId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        int requestCode = widgetId * 97 + action.hashCode();
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    private static String buildFooter(JSONObject counts) {
        if (counts == null) return "";
        List<String> parts = new ArrayList<>();
        int ddl = counts.optInt("ddl", 0);
        int tasks = counts.optInt("tasks", 0);
        if (ddl > 0) parts.add("DDL " + ddl);
        if (tasks > 0) parts.add("任务 " + tasks);
        return join(parts, " · ");
    }

    private static String join(List<String> parts, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) sb.append(sep);
            sb.append(parts.get(i));
        }
        return sb.toString();
    }

    private static void tint(RemoteViews views, int viewId, int color) {
        views.setInt(viewId, "setTextColor", color);
    }

    private static int parseColor(String raw, int fallback) {
        try {
            if (raw != null && raw.matches("^#[0-9a-fA-F]{6}$")) return Color.parseColor(raw);
        } catch (Exception ignored) {
            /* 使用默认色 */
        }
        return fallback;
    }

    private static int nowMinutes() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
    }

    private static PendingIntent openApp(Context context, String eventId, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (eventId != null && !eventId.isEmpty()) intent.putExtra("eventId", eventId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }
}
