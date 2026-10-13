package com.abivan.stub;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.cardemulation.CardEmulation;
import android.nfc.tech.Ndef;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Tap-to-pair. The sending phone shares its pairing code as an emulated NFC tag (StubTagService);
 * the receiving phone reads it in reader mode and passes the records to JS as a "tag" event.
 */
@CapacitorPlugin(name = "StubNfc")
public class StubNfcPlugin extends Plugin {
    private static final String MIME = "application/vnd.abivan.stub";
    private boolean sharing = false;
    private boolean reading = false;

    private NfcAdapter adapter() {
        return NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        NfcAdapter a = adapter();
        PackageManager pm = getContext().getPackageManager();
        JSObject r = new JSObject();
        r.put("read", a != null);
        r.put("share", a != null && pm.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION));
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    // --- share (emulate a tag) -------------------------------------------------------------

    @PluginMethod
    public void share(PluginCall call) {
        try {
            List<String> texts = call.getArray("records").toList();
            NdefRecord[] records = new NdefRecord[texts.size()];
            for (int i = 0; i < records.length; i++) {
                records[i] = NdefRecord.createMime(MIME, texts.get(i).getBytes(StandardCharsets.UTF_8));
            }
            byte[] msg = new NdefMessage(records).toByteArray();
            byte[] file = new byte[msg.length + 2];
            file[0] = (byte) (msg.length >> 8);
            file[1] = (byte) msg.length;
            System.arraycopy(msg, 0, file, 2, msg.length);
            StubTagService.ndefFile = file;
            sharing = true;
            prefer(true);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't prepare the NFC code", e);
        }
    }

    @PluginMethod
    public void stopShare(PluginCall call) {
        StubTagService.ndefFile = null;
        sharing = false;
        prefer(false);
        call.resolve();
    }

    /** While Stub is open on the Send screen, route NFC reads to Stub rather than a payment app. */
    private void prefer(boolean on) {
        NfcAdapter a = adapter();
        if (a == null || getActivity() == null) return;
        try {
            CardEmulation ce = CardEmulation.getInstance(a);
            if (on) ce.setPreferredService(getActivity(), new ComponentName(getContext(), StubTagService.class));
            else ce.unsetPreferredService(getActivity());
        } catch (Exception ignored) {
            // No HCE on this phone, or the activity isn't resumed yet; handleOnResume retries.
        }
    }

    // --- read (reader mode) ----------------------------------------------------------------

    @PluginMethod
    public void startReading(PluginCall call) {
        reading = true;
        enableReader();
        call.resolve();
    }

    @PluginMethod
    public void stopReading(PluginCall call) {
        reading = false;
        NfcAdapter a = adapter();
        if (a != null && getActivity() != null) a.disableReaderMode(getActivity());
        call.resolve();
    }

    private void enableReader() {
        NfcAdapter a = adapter();
        if (a == null || getActivity() == null) return;
        a.enableReaderMode(getActivity(), this::onTag, NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B, null);
    }

    private void onTag(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return;
        try {
            ndef.connect();
            NdefMessage msg = ndef.getNdefMessage();
            JSArray out = new JSArray();
            if (msg != null) {
                for (NdefRecord r : msg.getRecords()) {
                    if (r.getTnf() == NdefRecord.TNF_MIME_MEDIA && MIME.equals(new String(r.getType(), StandardCharsets.US_ASCII))) {
                        out.put(new String(r.getPayload(), StandardCharsets.UTF_8));
                    }
                }
            }
            if (out.length() > 0) {
                JSObject e = new JSObject();
                e.put("records", out);
                notifyListeners("tag", e);
            }
        } catch (Exception ignored) {
            // Phones moved apart mid-read; the user just taps again.
        } finally {
            try {
                ndef.close();
            } catch (Exception ignored) {
            }
        }
    }

    // Reader mode and the preferred service are tied to the resumed activity, so re-apply them.
    @Override
    protected void handleOnResume() {
        if (reading) enableReader();
        if (sharing) prefer(true);
    }

    @Override
    protected void handleOnPause() {
        NfcAdapter a = adapter();
        if (a != null && reading && getActivity() != null) a.disableReaderMode(getActivity());
        if (sharing) prefer(false);
    }
}
