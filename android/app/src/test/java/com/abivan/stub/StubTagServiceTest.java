package com.abivan.stub;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

import org.junit.After;
import org.junit.Test;

/** Plays the command sequence Android's NDEF reader sends to a Type 4 tag. */
public class StubTagServiceTest {
    private static final byte[] OK = { (byte) 0x90, 0x00 };
    private static final byte[] SELECT_APP = { 0x00, (byte) 0xA4, 0x04, 0x00, 0x07, (byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01, 0x00 };
    private static final byte[] SELECT_CC = { 0x00, (byte) 0xA4, 0x00, 0x0C, 0x02, (byte) 0xE1, 0x03 };
    private static final byte[] SELECT_NDEF = { 0x00, (byte) 0xA4, 0x00, 0x0C, 0x02, (byte) 0xE1, 0x04 };

    private static byte[] read(int offset, int le) {
        return new byte[] { 0x00, (byte) 0xB0, (byte) (offset >> 8), (byte) offset, (byte) le };
    }

    private static byte[] body(byte[] r) {
        assertArrayEquals("status word", OK, Arrays.copyOfRange(r, r.length - 2, r.length));
        return Arrays.copyOf(r, r.length - 2);
    }

    @After
    public void clear() {
        StubTagService.ndefFile = null;
    }

    @Test
    public void readerGetsTheWholeNdefFileInChunks() {
        byte[] msg = new byte[600]; // longer than one 255-byte read
        for (int i = 0; i < msg.length; i++) msg[i] = (byte) (i * 7);
        byte[] file = new byte[msg.length + 2];
        file[0] = (byte) (msg.length >> 8);
        file[1] = (byte) msg.length;
        System.arraycopy(msg, 0, file, 2, msg.length);
        StubTagService.ndefFile = file;

        StubTagService tag = new StubTagService();
        assertArrayEquals(OK, tag.processCommandApdu(SELECT_APP, null));
        assertArrayEquals(OK, tag.processCommandApdu(SELECT_CC, null));
        byte[] cc = body(tag.processCommandApdu(read(0, 15), null));
        assertEquals(15, cc.length);
        assertEquals((byte) 0xE1, cc[9]);
        assertEquals(0x04, cc[10]);

        assertArrayEquals(OK, tag.processCommandApdu(SELECT_NDEF, null));
        byte[] nlen = body(tag.processCommandApdu(read(0, 2), null));
        int len = ((nlen[0] & 0xFF) << 8) | (nlen[1] & 0xFF);
        assertEquals(600, len);

        ByteArrayOutputStream got = new ByteArrayOutputStream();
        int maxRead = cc[4] & 0xFF;
        for (int off = 2; off < len + 2; ) {
            byte[] chunk = body(tag.processCommandApdu(read(off, Math.min(maxRead, len + 2 - off)), null));
            got.write(chunk, 0, chunk.length);
            off += chunk.length;
        }
        assertArrayEquals(msg, got.toByteArray());
    }

    @Test
    public void staysSilentWithNothingToShareOrForOtherApps() {
        StubTagService tag = new StubTagService();
        assertArrayEquals(new byte[] { 0x6A, (byte) 0x82 }, tag.processCommandApdu(SELECT_APP, null));

        StubTagService.ndefFile = new byte[] { 0x00, 0x00 };
        byte[] otherApp = SELECT_APP.clone();
        otherApp[11] = 0x02;
        assertArrayEquals(new byte[] { 0x6A, (byte) 0x82 }, tag.processCommandApdu(otherApp, null));
        // No reads before the NDEF application is selected.
        assertArrayEquals(new byte[] { 0x6A, (byte) 0x82 }, tag.processCommandApdu(SELECT_CC, null));
    }
}
