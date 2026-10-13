package com.abivan.stub;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(StubFilesPlugin.class);
        registerPlugin(StubTransferPlugin.class);
        super.onCreate(savedInstanceState);
        // The transfer runs in the WebView, so keep its renderer at full priority when Stub is hidden.
        if (Build.VERSION.SDK_INT >= 26) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
