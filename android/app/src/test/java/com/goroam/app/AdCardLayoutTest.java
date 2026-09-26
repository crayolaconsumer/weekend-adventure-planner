package com.goroam.app;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class AdCardLayoutTest {

    // Greedy wrap with a pessimistic serif glyph width (0.55 em). Like Android's line breaker it
    // breaks at spaces and after hyphens.
    static int wrap(String text, float size, float width) {
        float charW = size * 0.55f;
        int lines = 1;
        float x = 0;
        for (String word : text.split(" ")) {
            String[] parts = word.split("(?<=-)");
            for (int p = 0; p < parts.length; p++) {
                float pw = parts[p].length() * charW;
                boolean space = p == 0 && x > 0;
                float need = x + (space ? charW : 0) + pw;
                if (need <= width) {
                    x = need;
                } else if (x == 0) {
                    lines += (int) Math.ceil(pw / width) - 1;
                    x = pw % width;
                } else {
                    lines++;
                    x = pw;
                }
            }
        }
        return lines;
    }

    static final String[] HEADLINES = {
            "Shop now",
            "Weekend breaks by the coast", // 28 chars
            "Discover hand-picked boutique hotels and cosy countryside cottages for your next escape",
    };
    static final float[][] SIZES = {{197, 295}, {223, 297}, {380, 507}};
    static final float OVERHANG = 0.21f; // Noto Serif: 1.36 em font height vs 1.15 line

    @Test
    public void noAssetOverlapsAndHeadlineKeeps25Chars() {
        for (float[] size : SIZES) {
            for (String headline : HEADLINES) {
                float w = size[0], h = size[1];
                AdCardLayout l = AdCardLayout.compute(w, h, headline, 62, 90, 17.6f, OVERHANG, AdCardLayoutTest::wrap);
                String ctx = w + "x" + h + " '" + headline + "' ";

                assertTrue(ctx + "media >= 120dp tall, got " + l.mediaH, l.mediaH >= 120);
                assertTrue(ctx + "media <= 56%", l.mediaH <= h * 0.56f + 0.5f);
                assertTrue(ctx + "headline size 16..24", l.headlineSize >= 16 && l.headlineSize <= 24);

                String first = headline.length() > 25 ? headline.substring(0, 25) + "…" : headline;
                assertTrue(ctx + "first 25 chars fit", wrap(first, l.headlineSize, w - 40) <= l.headlineLines);
                assertTrue(ctx + "body lines 0..2", l.bodyLines >= 0 && l.bodyLines <= 2);

                List<float[]> rects = new ArrayList<>();
                float in = AdCardLayout.INSET;
                assertTrue(ctx + "media >= 120dp wide", w - 2 * in >= 120);
                rects.add(new float[]{in, in, w - 2 * in, l.mediaH});
                rects.add(new float[]{20, l.rowY, l.pillW, 22});
                rects.add(new float[]{l.advertiserX, l.rowY, l.advertiserW, 22});
                rects.add(new float[]{20, l.headlineY, w - 40, l.headlineH});
                if (l.bodyLines > 0) rects.add(new float[]{20, l.bodyY, w - 40, l.bodyH});
                int skip = rects.size();
                rects.add(new float[]{20, l.buttonsY, 44, 44});
                rects.add(new float[]{l.ctaX, l.buttonsY, l.ctaW, 44});

                for (int i = 0; i < rects.size(); i++) {
                    float[] a = rects.get(i);
                    // Skip lives in the card; everything else in the inset NativeAdView.
                    float lo = i == skip ? 0 : in;
                    assertTrue(ctx + "rect " + i + " inside " + (i == skip ? "card" : "ad view"),
                            a[0] >= lo && a[1] >= lo && a[0] + a[2] <= w - lo + 0.01f && a[1] + a[3] <= h - lo + 0.01f);
                    for (int j = i + 1; j < rects.size(); j++) {
                        float[] b = rects.get(j);
                        boolean overlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
                                && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
                        assertTrue(ctx + "rects " + i + " and " + j + " overlap", !overlap);
                    }
                }
                System.out.printf("%s-> media %.0f, headline %.0fdp x %d lines (h %.1f), body %d lines%n",
                        ctx, l.mediaH, l.headlineSize, l.headlineLines, l.headlineH, l.bodyLines);
            }
        }
    }
}
