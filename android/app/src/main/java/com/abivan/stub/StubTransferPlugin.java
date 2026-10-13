package com.abivan.stub;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS calls keepAlive() while files are moving and release() when the queue is idle. */
@CapacitorPlugin(name = "StubTransfer")
public class StubTransferPlugin extends Plugin {
    private boolean askedForNotifications = false;

    @PluginMethod
    public void keepAlive(PluginCall call) {
        askForNotificationsOnce();
        Intent i = new Intent(getContext(), TransferService.class)
            .putExtra(TransferService.EXTRA_TITLE, call.getString("title", "Stub"))
            .putExtra(TransferService.EXTRA_TEXT, call.getString("text", ""))
            .putExtra(TransferService.EXTRA_PERCENT, call.getInt("percent", -1));
        try {
            // Repeated calls just update the notification.
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            // E.g. Android 15's daily dataSync budget is used up. The transfer still runs while Stub is open.
            call.reject("Background transfers are unavailable right now", e);
        }
    }

    @PluginMethod
    public void release(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TransferService.class));
        call.resolve();
    }

    /** The progress notification needs this on Android 13+. The service runs either way. */
    private void askForNotificationsOnce() {
        if (askedForNotifications || Build.VERSION.SDK_INT < 33) return;
        askedForNotifications = true;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7001);
        }
    }
}
