package com.abivan.stub;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Streams received files straight into the phone's Download/Stub folder, so large files
 * never sit in WebView memory. JS calls open, then write (base64 chunks) in order, then close.
 */
@CapacitorPlugin(name = "StubFiles")
public class StubFilesPlugin extends Plugin {
    private static final String FOLDER = "Stub";

    private static class Target {
        Uri uri; // MediaStore item (Android 10+)
        File file; // app folder fallback (Android 7 to 9)
        OutputStream out;
        String name;
    }

    private final Map<String, Target> open = new ConcurrentHashMap<>();
    // One thread keeps writes in order and off the UI thread.
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void open(PluginCall call) {
        String name = safeName(call.getString("name", "file"));
        String mime = call.getString("mime", "");
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
        String type = mime;
        io.execute(() -> {
            try {
                Target t = create(name, type);
                String id = UUID.randomUUID().toString();
                open.put(id, t);
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not create the file in Downloads", e);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        Target t = open.get(call.getString("id", ""));
        String data = call.getString("data", "");
        if (t == null) {
            call.reject("File is not open");
            return;
        }
        io.execute(() -> {
            try {
                t.out.write(Base64.decode(data, Base64.NO_WRAP));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not write the file. Is the phone out of space?", e);
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        Target t = open.remove(call.getString("id", ""));
        if (t == null) {
            call.reject("File is not open");
            return;
        }
        io.execute(() -> {
            try {
                t.out.close();
                if (t.uri != null && Build.VERSION.SDK_INT >= 29) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver().update(t.uri, done, null, null);
                }
                JSObject r = new JSObject();
                r.put("uri", contentUri(t).toString());
                r.put("savedTo", t.uri != null ? "Download/" + FOLDER + "/" + t.name : "Stub's app folder: " + t.name);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not finish saving the file", e);
            }
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        Target t = open.remove(call.getString("id", ""));
        io.execute(() -> {
            if (t != null) {
                try {
                    t.out.close();
                } catch (Exception ignored) {
                }
                if (t.uri != null) resolver().delete(t.uri, null, null);
                if (t.file != null) t.file.delete();
            }
            call.resolve();
        });
    }

    /** Hands a saved file to whichever app the user picks (Gallery, a PDF viewer, ...). */
    @PluginMethod
    public void openFile(PluginCall call) {
        Intent view = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(Uri.parse(call.getString("uri", "")), call.getString("mime", "*/*"))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(Intent.createChooser(view, null));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone can open this file");
        }
    }

    private Target create(String name, String mime) throws Exception {
        Target t = new Target();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
            v.put(MediaStore.Downloads.IS_PENDING, 1); // hidden from other apps until close()
            t.uri = resolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (t.uri == null) throw new IllegalStateException("MediaStore refused the file");
            t.out = new BufferedOutputStream(resolver().openOutputStream(t.uri), 1 << 20);
            t.name = name; // MediaStore adds " (1)" itself if the name is taken
        } else {
            // ponytail: Android 7 to 9 save to Stub's own folder (no storage permission needed).
            // Add WRITE_EXTERNAL_STORAGE (maxSdkVersion 28) if those phones need the public Downloads.
            File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("No storage");
            t.file = freeFile(dir, name);
            t.name = t.file.getName();
            t.out = new BufferedOutputStream(new FileOutputStream(t.file), 1 << 20);
        }
        return t;
    }

    private Uri contentUri(Target t) {
        if (t.uri != null) return t.uri;
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", t.file);
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private static String safeName(String name) {
        String clean = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (clean.isEmpty() || clean.startsWith(".")) clean = "file" + clean;
        return clean.length() > 200 ? clean.substring(0, 200) : clean;
    }

    private static File freeFile(File dir, String name) {
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        File f = new File(dir, name);
        for (int n = 2; f.exists(); n++) f = new File(dir, base + " (" + n + ")" + ext);
        return f;
    }
}
