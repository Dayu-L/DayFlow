package com.dayflow.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

/** 把网页层算好的提醒列表写入系统闹钟；重启或更新时间后按缓存重排。 */
final class ReminderScheduler {

    static final String PREFS = "dayflow_reminders";
    static final String KEY_PAYLOAD = "payload";
    static final String KEY_IDS = "ids";
    static final String ACTION_REMIND = "com.dayflow.app.REMIND";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_EVENT = "eventId";
    static final String CHANNEL_ID = "dayflow_reminders";

    private ReminderScheduler() {
    }

    static void sync(Context context, String json) {
        Context ctx = context.getApplicationContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        cancelAll(ctx, am);
        ensureChannel(ctx);

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String payload = json == null ? "[]" : json;
        JSONArray scheduledIds = new JSONArray();

        try {
            JSONArray list = new JSONArray(payload);
            long now = System.currentTimeMillis();
            int count = 0;

            for (int i = 0; i < list.length() && count < 240; i++) {
                JSONObject item = list.optJSONObject(i);
                if (item == null) continue;
                long triggerAt = item.optLong("triggerAt", 0L);
                if (triggerAt <= now + 1500L) continue;

                String key = item.optString("key", "");
                if (key.isEmpty()) {
                    key = "evt:" + item.optString("eventId", "") + ":" + triggerAt;
                }
                int id = key.hashCode();

                Intent intent = new Intent(ctx, ReminderReceiver.class)
                        .setAction(ACTION_REMIND)
                        .putExtra(EXTRA_KEY, key)
                        .putExtra(EXTRA_TITLE, item.optString("title", "日程提醒"))
                        .putExtra(EXTRA_BODY, item.optString("body", ""))
                        .putExtra(EXTRA_EVENT, item.optString("eventId", ""));
                PendingIntent pending = PendingIntent.getBroadcast(ctx, id, intent, pendingFlags());

                boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
                try {
                    if (Build.VERSION.SDK_INT >= 23) {
                        if (exact) {
                            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                        } else {
                            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                        }
                    } else if (exact) {
                        am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                    }
                    scheduledIds.put(id);
                    count++;
                } catch (SecurityException noExact) {
                    try {
                        am.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                        scheduledIds.put(id);
                        count++;
                    } catch (Exception ignored) {
                        pending.cancel();
                    }
                } catch (Exception ignored) {
                    pending.cancel();
                }
            }

            prefs.edit()
                    .putString(KEY_PAYLOAD, payload)
                    .putString(KEY_IDS, scheduledIds.toString())
                    .apply();
        } catch (Exception e) {
            prefs.edit().putString(KEY_PAYLOAD, "[]").putString(KEY_IDS, "[]").apply();
        }
    }

    static void rescheduleFromCache(Context context) {
        Context ctx = context.getApplicationContext();
        String payload = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_PAYLOAD, null);
        if (payload != null) sync(ctx, payload);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "日程提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("日程开始前的提醒");
        channel.enableVibration(true);
        nm.createNotificationChannel(channel);
    }

    static boolean needsExactAlarm(Context context) {
        if (Build.VERSION.SDK_INT < 31) return false;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && !am.canScheduleExactAlarms();
    }

    static void openExactAlarmSettings(Context context) {
        if (Build.VERSION.SDK_INT < 31) return;
        Context ctx = context.getApplicationContext();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + ctx.getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {
                /* 系统没有对应设置页 */
            }
        }
    }

    private static void cancelAll(Context ctx, AlarmManager am) {
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_IDS, "[]");
        try {
            JSONArray ids = new JSONArray(raw == null ? "[]" : raw);
            for (int i = 0; i < ids.length(); i++) {
                int id = ids.optInt(i);
                Intent intent = new Intent(ctx, ReminderReceiver.class).setAction(ACTION_REMIND);
                int flags = PendingIntent.FLAG_NO_CREATE;
                if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
                PendingIntent pending = PendingIntent.getBroadcast(ctx, id, intent, flags);
                if (pending != null) {
                    am.cancel(pending);
                    pending.cancel();
                }
            }
        } catch (Exception ignored) {
            /* 旧的 id 列表损坏时直接重排 */
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_IDS, "[]").apply();
    }

    private static int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }
}
