package com.abivan.stub;

import android.Manifest;
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
        try {
            // Repeated calls just update the notification.
            TransferService.hold(getContext(), TransferService.REASON_TRANSFER,
                call.getString("title", "Stub"), call.getString("text", ""), call.getInt("percent", -1));
            call.resolve();
        } catch (Exception e) {
            // E.g. Android 15's daily dataSync budget is used up. The transfer still runs while Stub is open.
            call.reject("Background transfers are unavailable right now", e);
        }
    }

    @PluginMethod
    public void release(PluginCall call) {
        TransferService.letGo(getContext(), TransferService.REASON_TRANSFER);
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
