package com.abivan.stub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps Stub running while files move with the screen off or another app open.
 * The transfer itself runs in the WebView; this service only holds the process,
 * the CPU and the Wi-Fi radio awake, and shows progress in a notification.
 */
public class TransferService extends Service {
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_PERCENT = "percent";
    // The service stays up while any reason holds it: files moving, or a hotspot other devices rely on.
    static final String EXTRA_REASON = "reason";
    static final String ACTION_HOLD = "com.abivan.stub.HOLD";
    static final String ACTION_LET_GO = "com.abivan.stub.LET_GO";
    static final String REASON_TRANSFER = "transfer";
    static final String REASON_HOTSPOT = "hotspot";

    /** Ask the service to stay up for `reason`. Safe to call repeatedly (later calls update the notification). */
    static void hold(Context c, String reason, String title, String text, int percent) {
        Intent i = new Intent(c, TransferService.class).setAction(ACTION_HOLD)
            .putExtra(EXTRA_REASON, reason)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_TEXT, text)
            .putExtra(EXTRA_PERCENT, percent);
        androidx.core.content.ContextCompat.startForegroundService(c, i);
    }

    static void letGo(Context c, String reason) {
        if (!running) return;
        try {
            c.startService(new Intent(c, TransferService.class).setAction(ACTION_LET_GO).putExtra(EXTRA_REASON, reason));
        } catch (Exception ignored) {
            // App fully in the background with no service: nothing to let go of.
        }
    }

    private static volatile boolean running = false;
    private final java.util.Set<String> reasons = new java.util.HashSet<>();
    private Intent lastTransfer;
    private static final String CHANNEL = "transfers";
    private static final int ID = 1;
    // Safety net: never hold the locks longer than this, even if JS forgets to call release().
    private static final long MAX_HOLD_MS = 6 * 60 * 60 * 1000L;

    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf(); // restarted by the system after a kill: the WebView transfer is gone
            return START_NOT_STICKY;
        }
        String reason = intent.getStringExtra(EXTRA_REASON);
        if (reason == null) reason = REASON_TRANSFER;
        if (ACTION_LET_GO.equals(intent.getAction())) {
            reasons.remove(reason);
            if (REASON_TRANSFER.equals(reason)) lastTransfer = null;
            if (reasons.isEmpty()) {
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            reasons.add(reason);
            if (REASON_TRANSFER.equals(reason)) lastTransfer = intent;
        }
        createChannel();
        // Transfer progress wins; otherwise say the hotspot is on.
        Notification n = notification(lastTransfer != null ? lastTransfer : hotspotIntent());
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, ID, n, type);
        running = true;
        holdLocks();
        return START_NOT_STICKY;
    }

    /** Android 15+: the daily dataSync budget (6 hours) ran out. Stop within seconds or the app crashes. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    private Intent hotspotIntent() {
        return new Intent()
            .putExtra(EXTRA_TITLE, "Stub's Wi-Fi is on")
            .putExtra(EXTRA_TEXT, "Other devices can join until you leave pairing or disconnect")
            .putExtra(EXTRA_PERCENT, -2);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (cpu != null && cpu.isHeld()) cpu.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void holdLocks() {
        if (cpu == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "stub:transfer");
            cpu.setReferenceCounted(false);
        }
        if (!cpu.isHeld()) cpu.acquire(MAX_HOLD_MS);
        if (wifi == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifi = wm.createWifiLock(mode, "stub:transfer");
            wifi.setReferenceCounted(false);
        }
        if (!wifi.isHeld()) wifi.acquire();
    }

    private Notification notification(Intent intent) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        int percent = intent.getIntExtra(EXTRA_PERCENT, -1);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_stub)
            .setContentTitle(intent.getStringExtra(EXTRA_TITLE))
            .setContentText(intent.getStringExtra(EXTRA_TEXT))
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (percent >= 0) b.setProgress(100, percent, false);
        else if (percent == -1) b.setProgress(0, 0, true); // -2: no progress bar (hotspot only)
        return b.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel c = new NotificationChannel(CHANNEL, "Transfers", NotificationManager.IMPORTANCE_LOW);
        c.setDescription("Shows progress while Stub sends or receives files");
        getSystemService(NotificationManager.class).createNotificationChannel(c);
    }
}
