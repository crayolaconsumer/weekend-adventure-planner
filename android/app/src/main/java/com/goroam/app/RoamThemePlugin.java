package com.goroam.app;

import android.graphics.Color;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RoamTheme")
public class RoamThemePlugin extends Plugin {

    @PluginMethod
    public void setSystemBarsBackground(PluginCall call) {
        String color = call.getString("color");
        if (color == null) {
            call.reject("color is required");
            return;
        }

        final int parsedColor;
        try {
            parsedColor = Color.parseColor(color);
        } catch (IllegalArgumentException err) {
            call.reject("Invalid color");
            return;
        }

        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().getDecorView().setBackgroundColor(parsedColor);
            getActivity().getWindow().setStatusBarColor(parsedColor);
            getActivity().getWindow().setNavigationBarColor(parsedColor);

            View root = getActivity().findViewById(android.R.id.content);
            if (root != null) {
                root.setBackgroundColor(parsedColor);
            }

            call.resolve();
        });
    }
}
