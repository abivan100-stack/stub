package com.abivan.stub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class StubHostServerTest {
    private StubHostServer server;
    private final Map<String, String> files = new HashMap<>();
    private String lastOffer;

    @Before
    public void start() throws Exception {
        files.put("index.html", "<!doctype html><title>Stub</title>");
        files.put("assets/app.js", "console.log(1)");
        server = new StubHostServer(0, "4821", path -> {
            String f = files.get(path);
            return f == null ? null : new ByteArrayInputStream(f.getBytes(StandardCharsets.UTF_8));
        }, offer -> {
            lastOffer = offer;
            if (offer.equals("bad")) throw new IllegalStateException("Not a Stub pairing code");
            return "aANSWER";
        });
        server.start();
    }

    @After
    public void stop() {
        server.stop();
    }

    private static class Reply {
        int status;
        String type;
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
    public void pairsOnlyWithTheRightPin() throws Exception {
        Reply wrong = request("POST", "/__stub/pair", "0000\noOFFER");
        assertEquals(403, wrong.status);

        Reply ok = request("POST", "/__stub/pair", "4821\noOFFER");
        assertEquals(200, ok.status);
        assertEquals("aANSWER", ok.body);
        assertEquals("oOFFER", lastOffer);

        // One pairing per session: a second device can't take over.
        assertEquals(409, request("POST", "/__stub/pair", "4821\noOTHER").status);
    }

    @Test
    public void locksAfterTooManyWrongPins() throws Exception {
        for (int i = 0; i < StubHostServer.MAX_WRONG_PINS; i++) {
            assertEquals(403, request("POST", "/__stub/pair", "000" + i + "\noOFFER").status);
        }
        assertEquals(429, request("POST", "/__stub/pair", "4821\noOFFER").status);
    }

    @Test
    public void passesOnWhyThePhoneRefused() throws Exception {
        Reply r = request("POST", "/__stub/pair", "4821\nbad");
        assertEquals(502, r.status);
        assertEquals("Not a Stub pairing code", r.body);
    }
}
