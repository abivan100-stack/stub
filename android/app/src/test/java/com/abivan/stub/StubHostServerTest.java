package com.abivan.stub;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class StubHostServerTest {
    private StubHostServer server;
    private final Map<String, String> files = new HashMap<>();
    private final LinkedBlockingQueue<String> guests = new LinkedBlockingQueue<>();

    @Before
    public void start() throws Exception {
        files.put("index.html", "<!doctype html><title>Stub</title>");
        files.put("assets/app.js", "console.log(1)");
        server = new StubHostServer(0, "4821", path -> {
            String f = files.get(path);
            return f == null ? null : new ByteArrayInputStream(f.getBytes(StandardCharsets.UTF_8));
        }, guests::add);
        server.start();
    }

    @After
    public void stop() {
        server.stop();
    }

    private static class Reply {
        int status;
        String type;
        String cors;
        String body;
    }

    private Reply request(String method, String path, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + server.port() + path).openConnection();
        c.setRequestMethod(method);
        if (body != null) {
            c.setDoOutput(true);
            try (OutputStream o = c.getOutputStream()) {
                o.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        Reply r = new Reply();
        r.status = c.getResponseCode();
        r.type = c.getContentType();
        r.cors = c.getHeaderField("Access-Control-Allow-Origin");
        InputStream in = r.status < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; in != null && (n = in.read(buf)) != -1; ) all.write(buf, 0, n);
        r.body = all.toString("UTF-8");
        return r;
    }

    @Test
    public void servesTheAppAndTellsThePageItCameFromAPhone() throws Exception {
        Reply host = request("GET", "/__stub/host", null);
        assertEquals(200, host.status);
        assertEquals("stub", host.body);
        assertEquals("*", host.cors);

        Reply page = request("GET", "/", null);
        assertEquals(200, page.status);
        assertTrue(page.type.startsWith("text/html"));
        assertTrue(page.body.contains("<title>Stub</title>"));

        Reply js = request("GET", "/assets/app.js?v=1", null);
        assertEquals(200, js.status);
        assertTrue(js.type.startsWith("text/javascript"));

        assertEquals(200, request("GET", "/some/route", null).status); // the app handles its own routes
        assertEquals(404, request("GET", "/assets/missing.js", null).status);
        assertEquals(404, request("GET", "/../secret.txt", null).status);
    }

    @Test
    public void pairsOnlyWithTheRightPinAndTellsThePhone() throws Exception {
        assertEquals(403, request("POST", "/__stub/pair", "0000").status);

        Reply ok = request("POST", "/__stub/pair", "4821");
        assertEquals(200, ok.status);
        assertTrue(ok.body.matches("[0-9a-f]{32}"));
        assertEquals(ok.body, guests.poll(2, TimeUnit.SECONDS));

        // One device per session: a second one can't take over.
        assertEquals(409, request("POST", "/__stub/pair", "4821").status);
    }

    @Test
    public void locksAfterTooManyWrongPins() throws Exception {
        for (int i = 0; i < StubHostServer.MAX_WRONG_PINS; i++) {
            assertEquals(403, request("POST", "/__stub/pair", "000" + i).status);
        }
        assertEquals(429, request("POST", "/__stub/pair", "4821").status);
    }

    @Test
    public void acceptKeyMatchesTheWebSocketSpecExample() {
        // RFC 6455, section 1.3
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", StubHostServer.acceptKey("dGhlIHNhbXBsZSBub25jZQ=="));
    }

    /** A bare-bones WebSocket client on a raw socket (java.net.http isn't on the Android test classpath). */
    private static class Ws {
        final Socket s;
        final InputStream in;
        final OutputStream out;

        Ws(int port, String query) throws Exception {
            s = new Socket("127.0.0.1", port);
            s.setSoTimeout(5000);
            in = new BufferedInputStream(s.getInputStream());
            out = s.getOutputStream();
            String hello = "GET /__stub/ws?" + query + " HTTP/1.1\r\n"
                + "Host: x\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                + "Sec-WebSocket-Version: 13\r\n\r\n";
            out.write(hello.getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String status = line();
            if (!status.contains(" 101 ")) throw new IOException(status);
            StringBuilder headers = new StringBuilder();
            for (String h = line(); !h.isEmpty(); h = line()) headers.append(h).append('\n');
            assertTrue(headers.toString().contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        }

        private String line() throws Exception {
            StringBuilder b = new StringBuilder();
            for (int c; (c = in.read()) != -1 && c != '\n'; ) if (c != '\r') b.append((char) c);
            return b.toString();
        }

        /** Clients must mask their frames. */
        void send(int opcode, byte[] data) throws Exception {
            ByteArrayOutputStream f = new ByteArrayOutputStream();
            f.write(0x80 | opcode);
            if (data.length < 126) {
                f.write(0x80 | data.length);
            } else if (data.length < 65536) {
                f.write(0x80 | 126);
                f.write(data.length >> 8);
                f.write(data.length);
            } else {
                f.write(0x80 | 127);
                for (int i = 7; i >= 0; i--) f.write((int) ((long) data.length >> (8 * i)));
            }
            byte[] mask = { 9, 8, 7, 6 };
            f.write(mask);
            for (int i = 0; i < data.length; i++) f.write(data[i] ^ mask[i & 3]);
            out.write(f.toByteArray());
            out.flush();
        }

        /** Returns {opcode, payload}, or null when the server closed the socket. */
        Object[] receive() throws Exception {
            int b0 = in.read();
            int b1 = in.read();
            if (b0 < 0 || b1 < 0) return null;
            assertEquals("server frames are unmasked", 0, b1 & 0x80);
            long len = b1 & 0x7F;
            if (len == 126) {
                len = (in.read() << 8) | in.read();
            } else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) len = (len << 8) | in.read();
            }
            byte[] data = new byte[(int) len];
            for (int off = 0; off < data.length; ) off += in.read(data, off, data.length - off);
            return new Object[] { b0 & 0x0F, data };
        }
    }

    @Test
    public void relaysTextAndLargeBinaryFramesBothWays() throws Exception {
        String token = request("POST", "/__stub/pair", "4821").body;
        Ws phone = new Ws(server.port(), "role=phone&token=" + token);
        Ws guest = new Ws(server.port(), "role=guest&token=" + token);

        byte[] offer = "{\"t\":\"offer\"}".getBytes(StandardCharsets.UTF_8);
        guest.send(0x1, offer);
        Object[] got = phone.receive();
        assertEquals(0x1, got[0]);
        assertArrayEquals(offer, (byte[]) got[1]);

        byte[] chunk = new byte[65536 + 36]; // one Stub chunk frame, bigger than the 16-bit length form
        for (int i = 0; i < chunk.length; i++) chunk[i] = (byte) (i * 7);
        phone.send(0x2, chunk);
        got = guest.receive();
        assertEquals(0x2, got[0]);
        assertArrayEquals(chunk, (byte[]) got[1]);

        // Pings are answered by the server itself.
        guest.send(0x9, new byte[] { 42 });
        got = guest.receive();
        assertEquals(0xA, got[0]);

        // One side leaving ends the session for the other.
        guest.send(0x8, new byte[0]);
        got = phone.receive();
        assertTrue(got == null || (int) got[0] == 0x8);
    }

    @Test
    public void refusesWrongTokensAndASecondGuest() throws Exception {
        String token = request("POST", "/__stub/pair", "4821").body;
        expectRefused("role=guest&token=00000000000000000000000000000000");
        new Ws(server.port(), "role=guest&token=" + token);
        expectRefused("role=guest&token=" + token); // the guest slot is taken
    }

    private void expectRefused(String query) throws Exception {
        try {
            new Ws(server.port(), query);
            throw new AssertionError("accepted: " + query);
        } catch (IOException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("403"));
        }
    }
}
