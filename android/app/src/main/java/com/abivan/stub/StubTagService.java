package com.abivan.stub;

import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.util.Arrays;

/**
 * Makes this phone look like an NFC Forum Type 4 tag holding Stub's pairing code, so another phone
 * can read it by tapping (Android Beam is gone, so host card emulation is the phone-to-phone route).
 * Implements just enough of the Type 4 tag protocol for Android's NDEF reader:
 * SELECT the NDEF application, SELECT the capability container or the NDEF file, READ BINARY.
 */
public class StubTagService extends HostApduService {
    /** NLEN (2 bytes) + NDEF message. Null means "nothing to share": the tag stays silent. */
    static volatile byte[] ndefFile = null;

    private static final byte[] NDEF_APP = { (byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01 };
    private static final int CC_ID = 0xE103;
    private static final int NDEF_ID = 0xE104;
    private static final int MAX_READ = 0xFF;
    private static final byte[] CC = {
        0x00, 0x0F, // CC length
        0x20, // mapping version 2.0
        0x00, (byte) MAX_READ, // max R-APDU data
        0x00, (byte) MAX_READ, // max C-APDU data
        0x04, 0x06, // NDEF file control TLV
        (byte) 0xE1, 0x04, // NDEF file id
        0x10, 0x00, // max NDEF file size (4 KB)
        0x00, // read access: open
        (byte) 0xFF, // write access: none
    };
    private static final byte[] OK = { (byte) 0x90, 0x00 };
    private static final byte[] NOT_FOUND = { 0x6A, (byte) 0x82 };
    private static final byte[] UNSUPPORTED = { 0x6D, 0x00 };

    private boolean appSelected = false;
    private byte[] file = null;

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        byte[] ndef = ndefFile;
        if (ndef == null || apdu == null || apdu.length < 4) return NOT_FOUND;
        int ins = apdu[1] & 0xFF;
        int p1 = apdu[2] & 0xFF;

        if (ins == 0xA4 && p1 == 0x04) { // SELECT by AID
            int lc = apdu.length > 4 ? apdu[4] & 0xFF : 0;
            appSelected = apdu.length >= 5 + lc && Arrays.equals(Arrays.copyOfRange(apdu, 5, 5 + lc), NDEF_APP);
            file = null;
            return appSelected ? OK : NOT_FOUND;
        }
        if (!appSelected) return NOT_FOUND;

        if (ins == 0xA4 && p1 == 0x00 && apdu.length >= 7) { // SELECT file by id
            int id = ((apdu[5] & 0xFF) << 8) | (apdu[6] & 0xFF);
            file = id == CC_ID ? CC : id == NDEF_ID ? ndef : null;
            return file != null ? OK : NOT_FOUND;
        }
        if (ins == 0xB0 && file != null) { // READ BINARY
            int offset = ((p1 & 0x7F) << 8) | (apdu[3] & 0xFF);
            int le = apdu.length > 4 ? apdu[4] & 0xFF : 0;
            if (le == 0 || le > MAX_READ) le = MAX_READ;
            if (offset > file.length) return NOT_FOUND;
            int n = Math.min(le, file.length - offset);
            byte[] out = Arrays.copyOf(Arrays.copyOfRange(file, offset, offset + n), n + 2);
            out[n] = (byte) 0x90;
            out[n + 1] = 0x00;
            return out;
        }
        return UNSUPPORTED;
    }

    @Override
    public void onDeactivated(int reason) {
        appSelected = false;
        file = null;
    }
}
