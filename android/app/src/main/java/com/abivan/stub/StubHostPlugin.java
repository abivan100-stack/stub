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

/**
 * "Connect another device": runs StubHostServer on port 8080 with a fresh 4-digit PIN. When a device
 * enters the PIN and its relay socket opens, JS gets a "guest" event with the session token and joins the relay as the phone.
 */
@CapacitorPlugin(name = "StubHost")
public class StubHostPlugin extends Plugin {
    private static final int PORT = 8080;
    private StubHostServer server;

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
            }, token -> {
                JSObject e = new JSObject();
                e.put("token", token);
                notifyListeners("guest", e, true);
            });
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
    }

    /** The phone's IPv4 addresses on Wi-Fi, its hotspot or Wi-Fi Direct (not mobile data). */
    private static JSArray addresses() {
        JSArray out = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName();
                // Allowlist, not a blocklist: mobile data goes by many names (rmnet, ccmni, seth_lte, v4-, r_rmnet...),
                // and a mobile-data address in the code sends the laptop to a phone it can never reach.
                if (!name.matches("(wlan|swlan|softap|ap|p2p|eth|rndis|ncm|bt-pan).*")) continue;
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
