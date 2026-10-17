package com.abivan.stub;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A tiny HTTP + WebSocket server that lets another device reach this phone on any network the
 * phone is on, including the phone's own hotspot or Wi-Fi Direct group, where Android's WebView
 * can't use WebRTC. The other device opens http://<phone-ip>:8080 (or the Stub website with the
 * phone's short code), enters the PIN, and both sides then talk through a WebSocket relay here.
 *
 *   GET  /__stub/host  -> "stub" (lets the page know it was served by a phone)
 *   POST /__stub/pair  -> body "PIN", reply a session token (one device per session)
 *   GET  /__stub/ws?role=phone|guest&token=T -> WebSocket; frames are passed to the other side.
 *        role=phone is accepted only from this phone itself (loopback).
 *   GET  anything else -> the web app's files
 *
 * Plain Java (no Android classes) so it runs in JVM unit tests.
 */
public class StubHostServer {
    public interface Assets {
        /** Opens a file of the web app ("index.html", "assets/x.js"), or returns null if there is none. */
        InputStream open(String path) throws IOException;
    }

    public interface Pairing {
        /** A device entered the right PIN and opened its relay socket; this phone's page should connect to the relay with `token`. */
        void guest(String token);
    }

    static final int MAX_WRONG_PINS = 5;
    private static final int MAX_BODY = 16 * 1024;
    private static final int MAX_FRAME = 4 * 1024 * 1024;
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "text/javascript; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("json", "application/json");
        TYPES.put("webmanifest", "application/manifest+json");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("wasm", "application/wasm");
    }

    private final Assets assets;
    private final Pairing pairing;
    private final String pin;
    private final ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private int wrongPins = 0;
    private String token = null; // set once a device has paired
    // The two ends of the relay, once connected. Guarded by `this`.
    private Socket phoneEnd = null;
    private Socket guestEnd = null;

    public StubHostServer(int port, String pin, Assets assets, Pairing pairing) throws IOException {
        this.pin = pin;
        this.assets = assets;
        this.pairing = pairing;
        ServerSocket s;
        try {
            s = new ServerSocket();
            s.setReuseAddress(true);
            s.bind(new InetSocketAddress(port));
        } catch (IOException busy) {
            s = new ServerSocket(0); // 8080 taken: any free port, shown on the phone anyway
        }
        server = s;
    }

    public int port() {
        return server.getLocalPort();
    }

    public void start() {
        pool.execute(() -> {
            while (!server.isClosed()) {
                try {
                    Socket client = server.accept();
                    pool.execute(() -> handle(client));
                } catch (IOException closed) {
                    return;
                }
            }
        });
    }

    public void stop() {
        try {
            server.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(10_000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                send(c, 400, "text/plain", bytes("Bad request"));
                return;
            }
            String method = parts[0];
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            String query = q >= 0 ? parts[1].substring(q + 1) : "";
            int length = 0;
            String wsKey = null;
            for (String h = readLine(in); h != null && !h.isEmpty(); h = readLine(in)) {
                int colon = h.indexOf(':');
                if (colon <= 0) continue;
                String name = h.substring(0, colon).trim();
                String value = h.substring(colon + 1).trim();
                if (name.equalsIgnoreCase("content-length")) length = Integer.parseInt(value);
                if (name.equalsIgnoreCase("sec-websocket-key")) wsKey = value;
            }
            if (path.equals("/__stub/ws") && wsKey != null) {
                relay(c, in, query, wsKey);
                return;
            }
            if (length > MAX_BODY) {
                send(c, 413, "text/plain", bytes("Too large"));
                return;
            }
            byte[] body = readFully(in, length);

            if (path.equals("/__stub/host")) {
                send(c, 200, "text/plain; charset=utf-8", bytes("stub"));
            } else if (path.equals("/__stub/pair") && method.equals("POST")) {
                pair(c, new String(body, StandardCharsets.UTF_8));
            } else if (method.equals("OPTIONS")) {
                send(c, 204, "text/plain", new byte[0]);
            } else if (method.equals("GET") || method.equals("HEAD")) {
                file(c, path, method.equals("HEAD"));
            } else {
                send(c, 405, "text/plain", bytes("Method not allowed"));
            }
        } catch (SocketTimeoutException | NumberFormatException ignored) {
            // slow or broken client; drop it
        } catch (IOException ignored) {
            // client went away
        }
    }

    private void pair(Socket c, String body) throws IOException {
        int nl = body.indexOf('\n');
        String gotPin = (nl < 0 ? body : body.substring(0, nl)).trim();
        String issued;
        synchronized (this) {
            if (token != null) {
                send(c, 409, "text/plain; charset=utf-8", bytes("This phone is already paired. Start again on the phone."));
                return;
            }
            if (wrongPins >= MAX_WRONG_PINS) {
                send(c, 429, "text/plain; charset=utf-8", bytes("Too many wrong PINs. Start again on the phone."));
                return;
            }
            if (!pin.equals(gotPin)) {
                wrongPins++;
                send(c, 403, "text/plain; charset=utf-8", bytes("That PIN doesn't match. Check the phone."));
                return;
            }
            token = randomToken();
            issued = token;
        }
        send(c, 200, "text/plain; charset=utf-8", bytes(issued));
    }

    // --- WebSocket relay ---------------------------------------------------------------------

    private void relay(Socket c, InputStream in, String query, String key) throws IOException {
        String role = param(query, "role");
        String got = param(query, "token");
        boolean phone = "phone".equals(role);
        synchronized (this) {
            boolean ok = token != null && token.equals(got)
                && (phone ? phoneEnd == null && c.getInetAddress().isLoopbackAddress() : "guest".equals(role) && guestEnd == null);
            if (!ok) {
                send(c, 403, "text/plain", bytes("Not allowed"));
                return;
            }
            // Claim the slot now, so a second guest can't race in during the handshake.
            if (phone) phoneEnd = c;
            else guestEnd = c;
            notifyAll();
        }
        OutputStream out = c.getOutputStream();
        out.write(bytes("HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"));
        out.flush();
        c.setSoTimeout(0); // a transfer can sit idle while the user picks files
        c.setTcpNoDelay(true);
        // Tell the phone only now, so its screen shows "Check the code" once this device is really
        // linked, not when the PIN matched (the other device's socket can still fail after that).
        if (!phone) pairing.guest(got);

        Socket other;
        synchronized (this) {
            long until = System.currentTimeMillis() + 60_000;
            while ((other = phone ? guestEnd : phoneEnd) == null) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) break;
                try {
                    wait(left);
                } catch (InterruptedException e) {
                    return;
                }
            }
        }
        try {
            if (other == null) return; // the other side never arrived
            pump(c, in, other);
        } finally {
            closeQuietly(other); // one side gone: end the session for both
        }
    }

    /** Copies every frame from `from` to `to` (unmasked, as servers must send), until either side closes. */
    private static void pump(Socket from, InputStream in, Socket to) throws IOException {
        OutputStream self = from.getOutputStream();
        OutputStream peer = to.getOutputStream();
        while (true) {
            int b0 = in.read();
            if (b0 < 0) return;
            int b1 = in.read();
            if (b1 < 0) return;
            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            long len = b1 & 0x7F;
            if (len == 126) len = (read(in) << 8) | read(in);
            else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) len = (len << 8) | read(in);
            }
            if (len > MAX_FRAME) return;
            byte[] mask = (b1 & 0x80) != 0 ? readFully(in, 4) : null;
            byte[] data = readFully(in, (int) len);
            if (mask != null) for (int i = 0; i < data.length; i++) data[i] ^= mask[i & 3];

            if (opcode == 0x9) { // ping: answer it ourselves
                writeFrame(self, true, 0xA, data);
            } else if (opcode == 0x8) { // close: pass it on, then stop
                writeFrame(peer, true, 0x8, data);
                return;
            } else if (opcode != 0xA) {
                writeFrame(peer, fin, opcode, data);
            }
        }
    }

    private static int read(InputStream in) throws IOException {
        int b = in.read();
        if (b < 0) throw new IOException("Frame ended early");
        return b;
    }

    private static void writeFrame(OutputStream out, boolean fin, int opcode, byte[] data) throws IOException {
        int n = data.length;
        byte first = (byte) ((fin ? 0x80 : 0) | opcode);
        byte[] head;
        if (n < 126) head = new byte[] { first, (byte) n };
        else if (n < 65536) head = new byte[] { first, 126, (byte) (n >> 8), (byte) n };
        else {
            head = new byte[10];
            head[0] = first;
            head[1] = 127;
            for (int i = 0; i < 8; i++) head[9 - i] = (byte) ((long) n >> (8 * i));
        }
        // Two threads can write to one socket (relayed data and our ping replies): keep frames whole.
        synchronized (out) {
            out.write(head);
            out.write(data);
            out.flush();
        }
    }

    static String acceptKey(String key) {
        try {
            byte[] sha = java.security.MessageDigest.getInstance("SHA-1").digest(bytes(key + WS_GUID));
            return base64(sha);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // java.util.Base64 needs Android 8+; Stub supports Android 7.
    private static String base64(byte[] b) {
        String abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < b.length; i += 3) {
            int n = (b[i] & 0xFF) << 16 | (i + 1 < b.length ? (b[i + 1] & 0xFF) << 8 : 0) | (i + 2 < b.length ? b[i + 2] & 0xFF : 0);
            out.append(abc.charAt(n >> 18 & 63)).append(abc.charAt(n >> 12 & 63));
            out.append(i + 1 < b.length ? abc.charAt(n >> 6 & 63) : '=');
            out.append(i + 2 < b.length ? abc.charAt(n & 63) : '=');
        }
        return out.toString();
    }

    private static String randomToken() {
        byte[] b = new byte[16];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static String param(String query, String name) {
        for (String kv : query.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && kv.substring(0, eq).equals(name)) return kv.substring(eq + 1);
        }
        return null;
    }

    private static void closeQuietly(Socket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (IOException ignored) {
        }
    }

    private void file(Socket c, String path, boolean headOnly) throws IOException {
        String p = path.startsWith("/") ? path.substring(1) : path;
        p = java.net.URLDecoder.decode(p.replace("+", "%2B"), "UTF-8");
        if (p.isEmpty()) p = "index.html";
        if (p.contains("..") || p.contains("\\") || p.startsWith("__stub")) {
            send(c, 404, "text/plain", bytes("Not found"));
            return;
        }
        InputStream f = assets.open(p);
        // Unknown paths without a file extension get the app itself (it has one page).
        if (f == null && !p.substring(p.lastIndexOf('/') + 1).contains(".")) {
            p = "index.html";
            f = assets.open(p);
        }
        if (f == null) {
            send(c, 404, "text/plain", bytes("Not found"));
            return;
        }
        byte[] data;
        try (InputStream in = f) {
            ByteArrayOutputStream all = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) != -1; ) all.write(buf, 0, n);
            data = all.toByteArray();
        }
        String ext = p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        send(c, 200, TYPES.getOrDefault(ext, "application/octet-stream"), headOnly ? null : data, data.length);
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static void send(Socket c, int status, String type, byte[] body) throws IOException {
        send(c, status, type, body, body.length);
    }

    private static void send(Socket c, int status, String type, byte[] body, int length) throws IOException {
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
            + "Content-Type: " + type + "\r\n"
            + "Content-Length: " + length + "\r\n"
            + "Cache-Control: no-store\r\n"
            // The Android app's own page (https://localhost) calls /__stub/pair on another phone.
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n";
        OutputStream out = c.getOutputStream();
        out.write(bytes(head));
        if (body != null) out.write(body);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            default: return "Bad Gateway";
        }
    }

    // Android 7 to 12 lack InputStream.readNBytes/readAllBytes, so read by hand.
    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] out = new byte[length];
        for (int off = 0; off < length; ) {
            int n = in.read(out, off, length - off);
            if (n < 0) throw new IOException("Body ended early");
            off += n;
        }
        return out;
    }

    /** Reads one CRLF-terminated header line as Latin-1 (headers are ASCII). */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') line.write(b);
            if (line.size() > 8192) throw new IOException("Header too long");
        }
        if (b == -1 && line.size() == 0) return null;
        return line.toString("ISO-8859-1");
    }
}
