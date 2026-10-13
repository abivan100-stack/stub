package com.abivan.stub;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Receives files from Android's share sheet ("Share → Stub"). Files shared while Stub is closed
 * arrive with the launch intent; files shared while it's open arrive through onNewIntent and a
 * "shared" event. JS calls take() to collect them.
 */
@CapacitorPlugin(name = "StubShare")
public class StubSharePlugin extends Plugin {
    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        collect(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (collect(intent)) notifyListeners("shared", new JSObject(), true);
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) files.put(f);
            pending.clear();
        }
        JSObject r = new JSObject();
        r.put("files", files);
        call.resolve(r);
    }

    private boolean collect(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        // Consume the intent so a rotation or relaunch doesn't offer the same files again.
        intent.setAction(null);
        if (uris.isEmpty()) return false;
        synchronized (pending) {
            for (Uri u : uris) pending.add(describe(u, intent.getType()));
        }
        return true;
    }

    private JSObject describe(Uri uri, String fallbackType) {
        JSObject f = new JSObject();
        f.put("uri", uri.toString());
        String name = uri.getLastPathSegment();
        long size = -1;
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                if (!c.isNull(0)) name = c.getString(0);
                if (!c.isNull(1)) size = c.getLong(1);
            }
        } catch (Exception ignored) {
            // Some apps share URIs that can't be queried; the name falls back to the path.
        }
        String type = getContext().getContentResolver().getType(uri);
        f.put("name", name == null ? "file" : name);
        f.put("size", size);
        f.put("type", type != null ? type : fallbackType != null && !fallbackType.contains("*") ? fallbackType : "");
        return f;
    }
}
