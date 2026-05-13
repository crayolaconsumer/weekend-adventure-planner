package com.goroam.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

/**
 * Capacitor BridgeActivity wired up for @capgo/capacitor-social-login Google
 * sign-in.
 *
 * Two things are required by the plugin and a previous fix only did the
 * first one:
 *
 *   1. Override onActivityResult to forward Google's OAuth intent result
 *      back to SocialLoginPlugin.
 *   2. Implement the marker interface
 *      `ModifiedMainActivityForSocialLoginPlugin`. The plugin does an
 *      `instanceof` check on the activity before allowing any code path
 *      that includes scopes (GoogleProvider.java:335). The interface
 *      has one no-op method that exists purely so the developer signs
 *      "yes I really did modify MainActivity".
 *
 * Without (2), the plugin rejects with "You CANNOT use scopes without
 * modifying the main activity. Please follow the docs!" — even when
 * `onActivityResult` is correctly overridden, because the check is a
 * type check, not a behaviour check.
 */
public class MainActivity extends BridgeActivity
        implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // Marker method — no body needed. The mere fact that this class
        // implements the interface is what the plugin checks via
        // `instanceof` to allow scope-bearing Google logins.
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android 15 (API 35) onwards enforces edge-to-edge for any app
        // targeting SDK 35+, and API 36 removed the legacy opt-out
        // (`windowOptOutEdgeToEdgeEnforcement`) entirely. The system bars
        // are transparent and the WebView is laid out behind them, which
        // pushes top-anchored UI (filter cog, ROAM wordmark) underneath
        // the status bar on devices like Pixel 9 Pro (Android 15+).
        //
        // @capacitor/status-bar `overlaysWebView:false` does not restore
        // pre-edge-to-edge behaviour on these devices. Instead we listen
        // for window insets on the content view and apply them as padding,
        // shifting the WebView frame below the status bar and above the
        // gesture/nav bar. This mirrors iOS's `contentInset:"always"`.
        View root = findViewById(android.R.id.content);
        if (root != null) {
            ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                // Consume only the systemBars inset — leave IME (keyboard)
                // and other insets to propagate so @capacitor/keyboard
                // still resizes the WebView when the keyboard opens.
                return new WindowInsetsCompat.Builder(insets)
                        .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
                        .build();
            });
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                Log.i("ROAM", "SocialLogin plugin handle missing on Google result");
                return;
            }
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                Log.i("ROAM", "SocialLogin handle is not SocialLoginPlugin");
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }
}
