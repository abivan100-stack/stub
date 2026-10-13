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
 * A tiny HTTP server so a laptop can pair without scanning anything: the laptop opens
 * http://<phone-ip>:8080, gets the same Stub web app, types the 4-digit PIN shown on the phone,
 * and posts its pairing code. The phone answers it and the server returns the answer.
 *
 *   GET  /__stub/host  -> "stub" (lets the page know it was served by a phone)
 *   POST /__stub/pair  -> body "PIN\nOFFER", reply the answer code
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
        /** Turns the laptop's offer into this phone's answer. Blocks until done; throws to refuse. */
        String answer(String offer) throws Exception;
    }

    static final int MAX_WRONG_PINS = 5;
    private static final int MAX_BODY = 16 * 1024;
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
    private boolean paired = false;

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
            int length = 0;
            for (String h = readLine(in); h != null && !h.isEmpty(); h = readLine(in)) {
                int colon = h.indexOf(':');
                if (colon > 0 && h.substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                    length = Integer.parseInt(h.substring(colon + 1).trim());
                }
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
        String gotPin = nl < 0 ? body.trim() : body.substring(0, nl).trim();
        String offer = nl < 0 ? "" : body.substring(nl + 1).trim();
        synchronized (this) {
            if (paired) {
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
        }
        try {
            String answer = pairing.answer(offer);
            synchronized (this) {
                paired = true;
            }
            send(c, 200, "text/plain; charset=utf-8", bytes(answer));
        } catch (Exception e) {
            String why = e.getMessage() == null ? "The phone couldn't answer. Try again." : e.getMessage();
            send(c, 502, "text/plain; charset=utf-8", bytes(why));
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
            + "Connection: close\r\n\r\n";
        OutputStream out = c.getOutputStream();
        out.write(bytes(head));
        if (body != null) out.write(body);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
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
