package com.abivan.stub;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileNotFoundException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * "Connect a laptop": runs StubHostServer on port 8080 with a fresh 4-digit PIN. When the laptop
 * posts its pairing code, JS gets an "offer" event, answers it, and calls answer() to reply.
 */
@CapacitorPlugin(name = "StubHost")
public class StubHostPlugin extends Plugin {
    private static final int PORT = 8080;
    private StubHostServer server;
    private final Map<String, CompletableFuture<String>> waiting = new ConcurrentHashMap<>();

    @PluginMethod
    public void start(PluginCall call) {
        stopQuietly();
        try {
            String pin = String.format("%04d", new SecureRandom().nextInt(10_000));
            server = new StubHostServer(PORT, pin, path -> {
                try {
                    return getContext().getAssets().open("public/" + path);
                } catch (FileNotFoundException e) {
                    return null;
                }
            }, this::askJs);
            server.start();
            JSObject r = new JSObject();
            r.put("port", server.port());
            r.put("pin", pin);
            r.put("addresses", addresses());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Couldn't start sharing on the network", e);
        }
    }

    /** Called again after making a hotspot, which adds an address. */
    @PluginMethod
    public void addresses(PluginCall call) {
        JSObject r = new JSObject();
        r.put("addresses", addresses());
        call.resolve(r);
    }

    @PluginMethod
    public void answer(PluginCall call) {
        CompletableFuture<String> f = waiting.remove(call.getString("id", ""));
        if (f != null) f.complete(call.getString("answer", ""));
        call.resolve();
    }

    @PluginMethod
    public void refuse(PluginCall call) {
        CompletableFuture<String> f = waiting.remove(call.getString("id", ""));
        if (f != null) f.completeExceptionally(new IllegalStateException(call.getString("message", "The phone refused")));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopQuietly();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopQuietly();
    }

    private void stopQuietly() {
        if (server != null) {
            server.stop();
            server = null;
        }
        for (CompletableFuture<String> f : waiting.values()) f.cancel(true);
        waiting.clear();
    }

    /** Runs on the server's thread: hand the offer to JS and wait for its answer. */
    private String askJs(String offer) throws Exception {
        String id = UUID.randomUUID().toString();
        CompletableFuture<String> f = new CompletableFuture<>();
        waiting.put(id, f);
        JSObject e = new JSObject();
        e.put("id", id);
        e.put("offer", offer);
        notifyListeners("offer", e, true);
        try {
            return f.get(30, TimeUnit.SECONDS);
        } catch (java.util.concurrent.ExecutionException ex) {
            throw (Exception) ex.getCause();
        } finally {
            waiting.remove(id);
        }
    }

    /** The phone's IPv4 addresses on Wi-Fi, its hotspot or Wi-Fi Direct (not mobile data). */
    private static JSArray addresses() {
        JSArray out = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName();
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("dummy") || name.startsWith("tun")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.put(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // no addresses: the screen says to join Wi-Fi or make a hotspot
        }
        return out;
    }
}
