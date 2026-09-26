package com.goroam.app;

import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "RoamNativeAd")
public class RoamNativeAdPlugin extends Plugin {

    private static class Slot {
        NativeAd ad;
        RoamAdCardView card;
        final List<PluginCall> pending = new ArrayList<>();
    }

    // Touched only on the main thread.
    private final Map<String, Slot> slots = new HashMap<>();

    @PluginMethod
    public void load(PluginCall call) {
        String slotId = call.getString("slot");
        String adUnitId = call.getString("adUnitId");
        if (slotId == null || adUnitId == null) {
            call.reject("slot and adUnitId are required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Slot existing = slots.get(slotId);
            if (existing != null) {
                if (existing.ad != null) resolveSlot(call, slotId);
                else existing.pending.add(call);
                return;
            }
            Slot slot = new Slot();
            slot.pending.add(call);
            slots.put(slotId, slot);

            AdLoader loader = new AdLoader.Builder(getContext(), adUnitId)
                    .forNativeAd(ad -> {
                        if (slots.get(slotId) != slot || getActivity().isDestroyed()) {
                            ad.destroy();
                            return;
                        }
                        slot.ad = ad;
                        for (PluginCall c : slot.pending) resolveSlot(c, slotId);
                        slot.pending.clear();
                    })
                    .withAdListener(new AdListener() {
                        @Override
                        public void onAdFailedToLoad(@NonNull LoadAdError error) {
                            if (slots.get(slotId) == slot) slots.remove(slotId);
                            for (PluginCall c : slot.pending) c.reject(error.getMessage());
                            slot.pending.clear();
                        }

                        @Override
                        public void onAdClicked() {
                            notifyListeners("adClicked", slotEvent(slotId));
                        }

                        @Override
                        public void onAdImpression() {
                            notifyListeners("adImpression", slotEvent(slotId));
                        }
                    })
                    .withNativeAdOptions(new NativeAdOptions.Builder()
                            .setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT)
                            .setMediaAspectRatio(NativeAdOptions.NATIVE_MEDIA_ASPECT_RATIO_ANY)
                            .build())
                    .build();
            loader.loadAd(new AdRequest.Builder().build());
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        String slotId = call.getString("slot");
        Double x = call.getDouble("x"), y = call.getDouble("y");
        Double width = call.getDouble("width"), height = call.getDouble("height");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        if (slotId == null || x == null || y == null || width == null || height == null) {
            call.reject("slot, x, y, width and height are required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Slot slot = slots.get(slotId);
            if (slot == null || slot.ad == null) {
                call.reject("Ad not loaded");
                return;
            }
            if (slot.card == null) {
                slot.card = new RoamAdCardView(getContext(), slot.ad, dir -> dismissed(slotId, dir));
            }
            RoamAdCardView card = slot.card;
            if (card.isDismissing()) {
                call.resolve();
                return;
            }

            View webView = bridge.getWebView();
            ViewGroup parent = (ViewGroup) webView.getParent();
            float density = getContext().getResources().getDisplayMetrics().density;
            int[] webLoc = new int[2];
            int[] parentLoc = new int[2];
            webView.getLocationInWindow(webLoc);
            parent.getLocationInWindow(parentLoc);
            int w = Math.round((float) (width * density));
            int h = Math.round((float) (height * density));
            int left = webLoc[0] - parentLoc[0] - parent.getPaddingLeft() + Math.round((float) (x * density));
            int top = webLoc[1] - parentLoc[1] - parent.getPaddingTop() + Math.round((float) (y * density));

            card.setFrame(w, h, dark);
            if (card.getParent() != parent) {
                if (card.getParent() != null) ((ViewGroup) card.getParent()).removeView(card);
                ViewGroup.MarginLayoutParams lp = new ViewGroup.MarginLayoutParams(w, h);
                lp.leftMargin = left;
                lp.topMargin = top;
                parent.addView(card, lp);
            } else {
                // Mutate in place: the parent converted our params to its own type on add.
                ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) card.getLayoutParams();
                lp.width = w;
                lp.height = h;
                lp.leftMargin = left;
                lp.topMargin = top;
                card.setLayoutParams(lp);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        String slotId = call.getString("slot");
        getActivity().runOnUiThread(() -> {
            Slot slot = slots.get(slotId);
            if (slot != null && slot.card != null && !slot.card.isDismissing()) detach(slot.card);
            call.resolve();
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        String slotId = call.getString("slot");
        getActivity().runOnUiThread(() -> {
            release(slots.remove(slotId));
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (Slot slot : slots.values()) release(slot);
        slots.clear();
    }

    private void dismissed(String slotId, String direction) {
        Slot slot = slots.remove(slotId);
        if (slot == null) return;
        release(slot);
        JSObject data = slotEvent(slotId);
        data.put("direction", direction);
        notifyListeners("adDismissed", data);
    }

    private void release(Slot slot) {
        if (slot == null) return;
        if (slot.card != null) {
            detach(slot.card);
            slot.card.destroy();
        }
        if (slot.ad != null) slot.ad.destroy();
        for (PluginCall c : slot.pending) c.reject("Ad destroyed");
        slot.pending.clear();
    }

    private static void detach(View view) {
        if (view.getParent() != null) ((ViewGroup) view.getParent()).removeView(view);
    }

    private static void resolveSlot(PluginCall call, String slotId) {
        call.resolve(slotEvent(slotId));
    }

    private static JSObject slotEvent(String slotId) {
        JSObject data = new JSObject();
        data.put("slot", slotId);
        return data;
    }
}
