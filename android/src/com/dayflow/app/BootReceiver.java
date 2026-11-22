package com.dayflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机、应用更新或修改时间后，重建所有系统提醒。 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            ReminderScheduler.rescheduleFromCache(context);
            DayFlowWidgetProvider.updateAll(context);
        }
    }
}
