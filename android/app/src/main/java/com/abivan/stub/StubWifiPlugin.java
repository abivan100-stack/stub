package com.abivan.stub;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.SoftApConfiguration;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Wi-Fi without a router: one phone makes a local-only hotspot (no internet, mobile data untouched),
 * the other joins it from the Wi-Fi QR code. WebRTC then finds both phones on that network.
 */
@CapacitorPlugin(
    name = "StubWifi",
    permissions = {
        // Android 13+: Wi-Fi features without location access.
        @Permission(alias = "nearby", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
        // Android 8 to 12 need location permission (and location turned on) for the same thing.
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    }
)
public class StubWifiPlugin extends Plugin {
    private static final int JOIN_TIMEOUT_MS = 30_000;

    private WifiManager.LocalOnlyHotspotReservation hotspot;
    private WifiP2pManager p2p;
    private WifiP2pManager.Channel p2pChannel;
    private boolean ownsGroup = false;
    private ConnectivityManager.NetworkCallback joined;

    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "nearby" : "location";
    }

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject r = new JSObject();
        r.put("hotspot", Build.VERSION.SDK_INT >= 26);
        r.put("join", Build.VERSION.SDK_INT >= 29);
        call.resolve(r);
    }

    // --- hotspot ---------------------------------------------------------------------------

    @PluginMethod
    public void startHotspot(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) {
            call.reject("This phone's Android version can't make a hotspot for Stub");
            return;
        }
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "afterHotspotPermission");
            return;
        }
        doStartHotspot(call);
    }

    @PermissionCallback
    private void afterHotspotPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26 && getPermissionState(alias()) == PermissionState.GRANTED) doStartHotspot(call);
        else call.reject("Stub needs the \"Nearby devices\" permission to make a hotspot");
    }

    @RequiresApi(26)
    private void doStartHotspot(PluginCall call) {
        stopHotspotQuietly();
        WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        try {
            wm.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
                @Override
                public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation) {
                    hotspot = reservation;
                    // Android stops a local-only hotspot when its app leaves the foreground (e.g. the
                    // user opens Settings). A foreground service keeps Stub "in use" meanwhile.
                    holdService();
                    call.resolve(describe(reservation));
                }

                @Override
                public void onStopped() {
                    hotspot = null;
                    letGoIfIdle();
                }

                @Override
                public void onFailed(int reason) {
                    call.reject(hotspotError(reason));
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (SecurityException | IllegalStateException e) {
            // Android 8 to 12 throw this when location is switched off.
            call.reject("Turn on Location in quick settings, then try again", e);
        }
    }

    @PluginMethod
    public void stopHotspot(PluginCall call) {
        stopHotspotQuietly();
        call.resolve();
    }

    private void stopHotspotQuietly() {
        if (hotspot != null && Build.VERSION.SDK_INT >= 26) {
            hotspot.close();
            hotspot = null;
        }
        letGoIfIdle();
    }

    private void holdService() {
        try {
            TransferService.hold(getContext(), TransferService.REASON_HOTSPOT, null, null, -2);
        } catch (Exception ignored) {
            // Android 15's background budget used up: the hotspot still works while Stub is on screen.
        }
    }

    private void letGoIfIdle() {
        if (hotspot == null && !ownsGroup) TransferService.letGo(getContext(), TransferService.REASON_HOTSPOT);
    }

    @RequiresApi(26)
    @SuppressWarnings("deprecation")
    private JSObject describe(WifiManager.LocalOnlyHotspotReservation r) {
        JSObject o = new JSObject();
        if (Build.VERSION.SDK_INT >= 30) {
            SoftApConfiguration c = r.getSoftApConfiguration();
            String ssid = Build.VERSION.SDK_INT >= 33 && c.getWifiSsid() != null ? c.getWifiSsid().toString() : c.getSsid();
            o.put("ssid", unquote(ssid));
            o.put("password", c.getPassphrase() == null ? "" : c.getPassphrase());
            int sec = c.getSecurityType();
            // WPA3-only hotspots need "SAE"; transition mode and WPA2 work with "WPA".
            o.put("security", sec == SoftApConfiguration.SECURITY_TYPE_OPEN ? "nopass" : sec == SoftApConfiguration.SECURITY_TYPE_WPA3_SAE ? "SAE" : "WPA");
            // The band isn't readable by apps (getBand is a system API), so it's left unset here.
        } else {
            WifiConfiguration c = r.getWifiConfiguration();
            o.put("ssid", unquote(c.SSID));
            o.put("password", c.preSharedKey == null ? "" : unquote(c.preSharedKey));
            o.put("security", c.preSharedKey == null ? "nopass" : "WPA");
        }
        return o;
    }

    private static String hotspotError(int reason) {
        switch (reason) {
            case WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE:
                return "Turn off your phone's regular hotspot first, then try again";
            case WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED:
                return "This phone doesn't allow hotspots (blocked by your carrier or work profile)";
            case WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL:
                return "No free Wi-Fi channel for a hotspot. Try again in a moment";
            default:
                return "The hotspot didn't start. Make sure Wi-Fi is on, then try again";
        }
    }

    // --- Wi-Fi Direct group (fallback when a local-only hotspot won't start) ----------------------

    @PluginMethod
    public void startDirectGroup(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "afterDirectPermission");
            return;
        }
        doStartDirectGroup(call);
    }

    @PermissionCallback
    private void afterDirectPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) doStartDirectGroup(call);
        else call.reject("Stub needs the \"Nearby devices\" permission to use Wi-Fi Direct");
    }

    @SuppressWarnings("MissingPermission") // checked above through the plugin's permission alias
    private void doStartDirectGroup(PluginCall call) {
        if (p2p == null) {
            p2p = (WifiP2pManager) getContext().getSystemService(Context.WIFI_P2P_SERVICE);
            if (p2p == null) {
                call.reject("This phone doesn't support Wi-Fi Direct");
                return;
            }
            p2pChannel = p2p.initialize(getContext(), Looper.getMainLooper(), null);
        }
        // Drop any old group first; createGroup fails with BUSY while one exists.
        p2p.removeGroup(p2pChannel, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                create(call);
            }

            @Override
            public void onFailure(int reason) {
                create(call);
            }
        });
    }

    @SuppressWarnings("MissingPermission")
    private void create(PluginCall call) {
        WifiP2pManager.ActionListener done = new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                ownsGroup = true;
                holdService();
                readGroup(call, 0);
            }

            @Override
            public void onFailure(int reason) {
                call.reject(reason == WifiP2pManager.P2P_UNSUPPORTED
                    ? "This phone doesn't support Wi-Fi Direct"
                    : "Wi-Fi Direct didn't start. Make sure Wi-Fi is on, then try again");
            }
        };
        if (Build.VERSION.SDK_INT >= 29) {
            // 2.4 GHz, so every laptop and phone can see it. Name must start with "DIRECT-xy-".
            WifiP2pConfig config = new WifiP2pConfig.Builder()
                .setNetworkName("DIRECT-st-Stub-" + randomText(4, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"))
                .setPassphrase(randomText(10, "abcdefghijkmnpqrstuvwxyz23456789"))
                .setGroupOperatingBand(WifiP2pConfig.GROUP_OWNER_BAND_2GHZ)
                .enablePersistentMode(false)
                .build();
            p2p.createGroup(p2pChannel, config, done);
        } else {
            p2p.createGroup(p2pChannel, done);
        }
    }

    private static String randomText(int n, String alphabet) {
        java.security.SecureRandom r = new java.security.SecureRandom();
        StringBuilder b = new StringBuilder(n);
        for (int i = 0; i < n; i++) b.append(alphabet.charAt(r.nextInt(alphabet.length())));
        return b.toString();
    }

    /** The group's name and password show up a moment after it starts, so poll briefly. */
    @SuppressWarnings("MissingPermission")
    private void readGroup(PluginCall call, int attempt) {
        p2p.requestGroupInfo(p2pChannel, (WifiP2pGroup g) -> {
            if (g != null && g.getNetworkName() != null && g.getPassphrase() != null) {
                JSObject o = new JSObject();
                o.put("ssid", g.getNetworkName());
                o.put("password", g.getPassphrase());
                o.put("security", "WPA");
                o.put("band", Build.VERSION.SDK_INT >= 29 ? "2.4 GHz" : "");
                call.resolve(o);
            } else if (attempt < 20) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> readGroup(call, attempt + 1), 250);
            } else {
                call.reject("Wi-Fi Direct started but didn't report its network name");
            }
        });
    }

    @PluginMethod
    public void stopDirectGroup(PluginCall call) {
        stopDirectQuietly();
        call.resolve();
    }

    private void stopDirectQuietly() {
        if (p2p != null && ownsGroup) {
            p2p.removeGroup(p2pChannel, null);
            ownsGroup = false;
        }
        letGoIfIdle();
    }

    // --- join ------------------------------------------------------------------------------

    @PluginMethod
    public void joinWifi(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("Join this Wi-Fi in Settings, then come back to Stub");
            return;
        }
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "afterJoinPermission");
            return;
        }
        doJoin(call);
    }

    @PermissionCallback
    private void afterJoinPermission(PluginCall call) {
        // Joining works without it on most phones; ask, but try either way.
        doJoin(call);
    }

    private void doJoin(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) return;
        String ssid = call.getString("ssid", "");
        String password = call.getString("password", "");
        String security = call.getString("security", "WPA");
        WifiNetworkSpecifier.Builder spec = new WifiNetworkSpecifier.Builder().setSsid(ssid);
        if ("SAE".equalsIgnoreCase(security)) spec.setWpa3Passphrase(password);
        else if (!"nopass".equalsIgnoreCase(security)) spec.setWpa2Passphrase(password);

        NetworkRequest request = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) // a local-only hotspot has none
            .setNetworkSpecifier(spec.build())
            .build();

        ConnectivityManager cm = connectivity();
        leaveQuietly();
        joined = new ConnectivityManager.NetworkCallback() {
            private boolean answered = false;

            @Override
            public void onAvailable(Network network) {
                // Route Stub's traffic (including WebRTC) over this Wi-Fi rather than mobile data.
                cm.bindProcessToNetwork(network);
                if (answered) return;
                answered = true;
                JSObject r = new JSObject();
                r.put("ssid", ssid);
                call.resolve(r);
            }

            @Override
            public void onUnavailable() {
                if (answered) return;
                answered = true;
                call.reject("Couldn't join " + ssid + ". Check the other phone still shows its Wi-Fi code");
            }

            @Override
            public void onLost(Network network) {
                cm.bindProcessToNetwork(null);
            }
        };
        // Android shows its own "Connect to device?" dialog here.
        cm.requestNetwork(request, joined, JOIN_TIMEOUT_MS);
    }

    @PluginMethod
    public void leaveWifi(PluginCall call) {
        leaveQuietly();
        call.resolve();
    }

    private void leaveQuietly() {
        if (joined != null) {
            ConnectivityManager cm = connectivity();
            cm.bindProcessToNetwork(null);
            try {
                cm.unregisterNetworkCallback(joined);
            } catch (IllegalArgumentException ignored) {
                // already released by a timeout
            }
            joined = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopHotspotQuietly();
        stopDirectQuietly();
        leaveQuietly();
    }

    private ConnectivityManager connectivity() {
        return (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    private static String unquote(String s) {
        if (s == null) return "";
        return s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"") ? s.substring(1, s.length() - 1) : s;
    }
}
